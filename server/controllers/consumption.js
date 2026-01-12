/**
 * Consumption Controller
 * Handles consumption recording at Centros with SAP DeliveryNote integration
 */
const { validationResult } = require('express-validator');
const {
  getConsumosModel,
  getLocacionesModel,
  getProductosModel,
  getLotesModel,
  getInventarioModel,
} = require('../getModel');
const sapService = require('../services/sapService');
const { extractConsumptionDocument } = require('../services/extractionService');

/**
 * GET /api/consumption/inventory/:centroId
 * Get available products and lots at a Centro for consumption
 */
exports.getAvailableInventory = async (req, res, next) => {
  try {
    const { centroId } = req.params;

    // Get the Centro
    const Locaciones = await getLocacionesModel(req.companyId);
    const centro = await Locaciones.findById(centroId).lean();

    if (!centro) {
      return res.status(404).json({ error: 'Centro no encontrado' });
    }

    if (centro.type !== 'CENTRO') {
      return res.status(400).json({ error: 'La locación no es un Centro' });
    }

    // Get lots at this Centro with available quantity
    const Lotes = await getLotesModel(req.companyId);
    const lots = await Lotes.find({
      currentLocationId: centroId,
      quantityAvailable: { $gt: 0 },
      status: 'ACTIVE',
    }).lean();

    // Get product details
    const Productos = await getProductosModel(req.companyId);
    const productIds = [...new Set(lots.map(l => l.productId.toString()))];
    const products = await Productos.find({
      _id: { $in: productIds },
    }).lean();

    // Build response grouped by product
    const productMap = new Map();
    products.forEach(p => {
      productMap.set(p._id.toString(), {
        productId: p._id,
        productCode: p.code,
        productName: p.name,
        sapItemCode: p.sapItemCode,
        price: p.price || null,
        currency: p.currency || 'USD',
        lots: [],
      });
    });

    // Add lots to their products
    lots.forEach(lot => {
      const product = productMap.get(lot.productId.toString());
      if (product) {
        product.lots.push({
          loteId: lot._id,
          lotNumber: lot.lotNumber,
          quantityAvailable: lot.quantityAvailable,
          expiryDate: lot.expiryDate,
        });
      }
    });

    // Sort lots by expiry date (FEFO)
    const items = Array.from(productMap.values())
      .filter(p => p.lots.length > 0)
      .map(p => ({
        ...p,
        lots: p.lots.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate)),
      }));

    res.json({
      centro: {
        _id: centro._id,
        name: centro.name,
        fullName: centro.fullName,
        sapCardCode: centro.sapIntegration?.cardCode,
        sapCardName: centro.sapIntegration?.cardName,
      },
      items,
    });
  } catch (error) {
    console.error('Error getting available inventory:', error);
    next(error);
  }
};

/**
 * POST /api/consumption/extract
 * Extract consumption data from uploaded documents using Claude Vision
 */
exports.extractFromDocument = async (req, res, next) => {
  try {
    const { centroId } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron archivos' });
    }

    console.log(`Extracting consumption data from ${req.files.length} file(s)...`);

    // Extract data using Claude Vision
    const extractionResult = await extractConsumptionDocument(req.files);

    // Try to match extracted items with inventory at this Centro
    const Lotes = await getLotesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);

    const enrichedItems = [];
    for (const item of extractionResult.items) {
      let matchedProduct = null;
      let matchedLote = null;
      let availableLots = [];

      // Try to find product by code
      if (item.code) {
        matchedProduct = await Productos.findOne({
          $or: [
            { sapItemCode: String(item.code) },
            { code: item.code },
          ],
        }).lean();
      }

      // If product found, get available lots at this Centro
      if (matchedProduct && centroId) {
        const lots = await Lotes.find({
          productId: matchedProduct._id,
          currentLocationId: centroId,
          quantityAvailable: { $gt: 0 },
          status: 'ACTIVE',
        }).lean();

        availableLots = lots.map(l => ({
          loteId: l._id,
          lotNumber: l.lotNumber,
          quantityAvailable: l.quantityAvailable,
          expiryDate: l.expiryDate,
        })).sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

        // Try to match lot number if provided
        if (item.lotNumber) {
          matchedLote = lots.find(l => l.lotNumber === item.lotNumber);
        } else if (lots.length === 1) {
          // Auto-select if only one lot available
          matchedLote = lots[0];
        }
      }

      enrichedItems.push({
        ...item,
        matchedProductId: matchedProduct?._id || null,
        matchedProductName: matchedProduct?.name || null,
        sapItemCode: matchedProduct?.sapItemCode || item.code,
        matchedLoteId: matchedLote?._id || null,
        matchedLotNumber: matchedLote?.lotNumber || item.lotNumber,
        availableLots,
        needsLotSelection: !matchedLote && availableLots.length > 1,
        price: matchedProduct?.price || null,
        currency: matchedProduct?.currency || 'USD',
      });
    }

    res.json({
      success: true,
      items: enrichedItems,
      warnings: extractionResult.warnings || [],
      filesProcessed: req.files.length,
    });
  } catch (error) {
    console.error('Error extracting from document:', error);
    res.status(500).json({
      error: `Extraction failed: ${error.message}`,
    });
  }
};

/**
 * POST /api/consumption
 * Create consumption record with SAP DeliveryNote
 */
exports.create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      centroId,
      items,
      patientName,
      doctorName,
      procedureDate,
      procedureType,
      notes,
    } = req.body;

    // Validate Centro
    const Locaciones = await getLocacionesModel(req.companyId);
    const centro = await Locaciones.findById(centroId).lean();

    if (!centro) {
      return res.status(404).json({ error: 'Centro no encontrado' });
    }

    if (!centro.sapIntegration?.cardCode) {
      return res.status(400).json({
        error: 'El Centro no tiene un cliente SAP configurado. Configure el cliente SAP en Locaciones primero.'
      });
    }

    // Validate items and get lot details
    const Lotes = await getLotesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);
    const consumoItems = [];
    const sapItems = [];

    for (const item of items) {
      const lote = await Lotes.findById(item.loteId);
      if (!lote) {
        return res.status(400).json({ error: `Lote ${item.loteId} no encontrado` });
      }

      if (lote.currentLocationId.toString() !== centroId) {
        return res.status(400).json({ error: `El lote ${lote.lotNumber} no está en este Centro` });
      }

      if (lote.quantityAvailable < item.quantity) {
        return res.status(400).json({
          error: `Cantidad insuficiente para lote ${lote.lotNumber}. Disponible: ${lote.quantityAvailable}`
        });
      }

      const product = await Productos.findById(item.productId || lote.productId).lean();

      consumoItems.push({
        productId: product._id,
        sapItemCode: product.sapItemCode,
        productName: product.name,
        loteId: lote._id,
        lotNumber: lote.lotNumber,
        quantity: item.quantity,
        price: product.price || null,
        currency: product.currency || 'USD',
      });

      sapItems.push({
        itemCode: product.sapItemCode,
        quantity: item.quantity,
        batchNumber: lote.lotNumber,
        price: product.price,
        currency: product.currency || 'USD',
      });

      // Update lot quantity
      lote.quantityAvailable -= item.quantity;
      lote.quantityConsumed += item.quantity;
      lote.historia.push({
        fecha: new Date(),
        user: {
          _id: req.user._id,
          firstname: req.user.firstname,
          lastname: req.user.lastname,
        },
        accion: 'Consumo registrado',
        detalles: `Cantidad: ${item.quantity}, Centro: ${centro.name}`,
      });

      if (lote.quantityAvailable === 0) {
        lote.status = 'DEPLETED';
      }

      await lote.save();
    }

    // Build comments for SAP
    const commentParts = [];
    if (patientName) commentParts.push(`Px: ${patientName}`);
    if (doctorName) commentParts.push(`Dr: ${doctorName}`);
    if (procedureDate) commentParts.push(`Fecha: ${new Date(procedureDate).toLocaleDateString('es-DO')}`);
    if (procedureType) commentParts.push(`Procedimiento: ${procedureType}`);
    commentParts.push(`Consignación: ${centro.name}`);
    const sapComments = commentParts.join('\n');

    // Create SAP DeliveryNote
    let sapResult = { success: false, error: null };
    try {
      const deliveryResult = await sapService.createDeliveryNote({
        cardCode: centro.sapIntegration.cardCode,
        cardName: centro.sapIntegration.cardName || centro.name,
        warehouseCode: centro.sapIntegration.warehouseCode || '10',
        binAbsEntry: centro.sapIntegration.binAbsEntry || null,
        items: sapItems,
        comments: sapComments,
        doctorName: doctorName || null,
      });

      sapResult = {
        success: true,
        sapDocEntry: deliveryResult.DocEntry,
        sapDocNum: deliveryResult.DocNum,
        sapDocType: 'DeliveryNotes',
      };
    } catch (sapError) {
      console.error('SAP DeliveryNote creation failed:', sapError);
      sapResult = {
        success: false,
        error: sapError.message,
      };
    }

    // Create Consumo record
    const Consumos = await getConsumosModel(req.companyId);
    const consumo = new Consumos({
      centroId: centro._id,
      centroName: centro.name,
      sapCardCode: centro.sapIntegration.cardCode,
      items: consumoItems,
      patientName,
      doctorName,
      procedureDate: procedureDate ? new Date(procedureDate) : null,
      procedureType,
      sapSync: {
        pushed: sapResult.success,
        sapDocEntry: sapResult.sapDocEntry,
        sapDocNum: sapResult.sapDocNum,
        sapDocType: sapResult.sapDocType || 'DeliveryNotes',
        pushedAt: sapResult.success ? new Date() : null,
        error: sapResult.error,
      },
      notes,
      status: sapResult.success ? 'SYNCED' : 'FAILED',
      createdBy: {
        _id: req.user._id,
        firstname: req.user.firstname,
        lastname: req.user.lastname,
        email: req.user.email,
      },
    });

    await consumo.save();

    // Update inventario aggregates
    const Inventario = await getInventarioModel(req.companyId);
    for (const item of consumoItems) {
      await Inventario.findOneAndUpdate(
        { productId: item.productId, locationId: centroId },
        {
          $inc: {
            quantityAvailable: -item.quantity,
            quantityConsumed: item.quantity,
          },
          $set: { lastMovementDate: new Date() },
        },
        { upsert: false }
      );
    }

    res.status(201).json({
      success: true,
      consumo: {
        _id: consumo._id,
        centroName: consumo.centroName,
        totalItems: consumo.totalItems,
        totalQuantity: consumo.totalQuantity,
        totalValue: consumo.totalValue,
        status: consumo.status,
      },
      sapResult,
    });
  } catch (error) {
    console.error('Error creating consumption:', error);
    next(error);
  }
};

/**
 * GET /api/consumption/history
 * Get consumption history with filters
 */
exports.getHistory = async (req, res, next) => {
  try {
    const { centroId, startDate, endDate, limit = 50, skip = 0 } = req.query;

    const Consumos = await getConsumosModel(req.companyId);

    const query = {};
    if (centroId) query.centroId = centroId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [consumos, total] = await Promise.all([
      Consumos.find(query)
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .lean(),
      Consumos.countDocuments(query),
    ]);

    res.json({
      consumos,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip),
    });
  } catch (error) {
    console.error('Error getting consumption history:', error);
    next(error);
  }
};

/**
 * GET /api/consumption/:id
 * Get single consumption details
 */
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    const Consumos = await getConsumosModel(req.companyId);
    const consumo = await Consumos.findById(id).lean();

    if (!consumo) {
      return res.status(404).json({ error: 'Consumo no encontrado' });
    }

    res.json(consumo);
  } catch (error) {
    console.error('Error getting consumption:', error);
    next(error);
  }
};

/**
 * POST /api/consumption/:id/retry-sap
 * Retry SAP sync for a failed consumption
 */
exports.retrySap = async (req, res, next) => {
  try {
    const { id } = req.params;

    const Consumos = await getConsumosModel(req.companyId);
    const consumo = await Consumos.findById(id);

    if (!consumo) {
      return res.status(404).json({ error: 'Consumo no encontrado' });
    }

    if (consumo.sapSync.pushed) {
      return res.status(400).json({ error: 'Este consumo ya está sincronizado con SAP' });
    }

    // Get Centro for SAP customer code
    const Locaciones = await getLocacionesModel(req.companyId);
    const centro = await Locaciones.findById(consumo.centroId).lean();

    if (!centro?.sapIntegration?.cardCode) {
      return res.status(400).json({ error: 'El Centro no tiene cliente SAP configurado' });
    }

    // Build SAP items
    const sapItems = consumo.items.map(item => ({
      itemCode: item.sapItemCode,
      quantity: item.quantity,
      batchNumber: item.lotNumber,
      price: item.price,
      currency: item.currency || 'USD',
    }));

    // Build comments
    const commentParts = [];
    if (consumo.patientName) commentParts.push(`Px: ${consumo.patientName}`);
    if (consumo.doctorName) commentParts.push(`Dr: ${consumo.doctorName}`);
    if (consumo.procedureDate) commentParts.push(`Fecha: ${new Date(consumo.procedureDate).toLocaleDateString('es-DO')}`);
    commentParts.push(`Consignación: ${centro.name}`);
    const sapComments = commentParts.join('\n');

    // Retry SAP DeliveryNote
    try {
      const deliveryResult = await sapService.createDeliveryNote({
        cardCode: centro.sapIntegration.cardCode,
        cardName: centro.sapIntegration.cardName || centro.name,
        warehouseCode: centro.sapIntegration.warehouseCode || '10',
        binAbsEntry: centro.sapIntegration.binAbsEntry || null,
        items: sapItems,
        comments: sapComments,
        doctorName: consumo.doctorName || null,
      });

      consumo.sapSync = {
        pushed: true,
        sapDocEntry: deliveryResult.DocEntry,
        sapDocNum: deliveryResult.DocNum,
        sapDocType: 'DeliveryNotes',
        pushedAt: new Date(),
        error: null,
      };
      consumo.status = 'SYNCED';
      await consumo.save();

      res.json({
        success: true,
        sapResult: {
          sapDocEntry: deliveryResult.DocEntry,
          sapDocNum: deliveryResult.DocNum,
        },
      });
    } catch (sapError) {
      consumo.sapSync.error = sapError.message;
      await consumo.save();

      res.status(500).json({
        success: false,
        error: sapError.message,
      });
    }
  } catch (error) {
    console.error('Error retrying SAP sync:', error);
    next(error);
  }
};
