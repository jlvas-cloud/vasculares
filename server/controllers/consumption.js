/**
 * Consumption Controller
 * Handles consumption recording at Centros with SAP DeliveryNote integration
 *
 * IMPORTANT: SAP sync is atomic - if SAP fails, nothing is saved locally.
 * This ensures data consistency between local DB and SAP.
 */
const mongoose = require('mongoose');
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
 *
 * ATOMIC: SAP is called FIRST. If SAP fails, nothing is saved locally.
 * If SAP succeeds, local changes are committed in a transaction.
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

    // ============================================
    // PHASE 1: VALIDATION (no saves)
    // ============================================

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

    // Validate items and prepare data (NO SAVES YET)
    const Lotes = await getLotesModel(req.companyId);
    const Productos = await getProductosModel(req.companyId);
    const validatedItems = [];

    for (const item of items) {
      const lote = await Lotes.findById(item.loteId).lean();
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

      validatedItems.push({
        lote,
        product,
        quantity: item.quantity,
      });
    }

    // Prepare SAP items
    const sapItems = validatedItems.map(({ product, lote, quantity }) => ({
      itemCode: product.sapItemCode,
      quantity: quantity,
      batchNumber: lote.lotNumber,
      price: product.price,
      currency: product.currency || 'USD',
    }));

    // Build comments for SAP
    const commentParts = [];
    if (patientName) commentParts.push(`Px: ${patientName}`);
    if (doctorName) commentParts.push(`Dr: ${doctorName}`);
    if (procedureDate) commentParts.push(`Fecha: ${new Date(procedureDate).toLocaleDateString('es-DO')}`);
    if (procedureType) commentParts.push(`Procedimiento: ${procedureType}`);
    commentParts.push(`Consignación: ${centro.name}`);
    const sapComments = commentParts.join('\n');

    // ============================================
    // PHASE 2: SAP CALL (before any local saves)
    // ============================================

    let sapResult;
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
      // SAP failed - return error, save nothing locally
      console.error('SAP DeliveryNote creation failed:', sapError);
      return res.status(500).json({
        success: false,
        error: `SAP Error: ${sapError.message}`,
        sapError: sapError.message,
      });
    }

    // ============================================
    // PHASE 3: LOCAL SAVES (in transaction)
    // SAP succeeded, now commit local changes
    // ============================================

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Prepare consumo items
      const consumoItems = validatedItems.map(({ product, lote, quantity }) => ({
        productId: product._id,
        sapItemCode: product.sapItemCode,
        productName: product.name,
        loteId: lote._id,
        lotNumber: lote.lotNumber,
        quantity: quantity,
        price: product.price || null,
        currency: product.currency || 'USD',
      }));

      // Update lot quantities
      for (const { lote, quantity } of validatedItems) {
        const newQuantity = lote.quantityAvailable - quantity;
        const updateData = {
          $inc: {
            quantityAvailable: -quantity,
            quantityConsumed: quantity,
          },
          $push: {
            historia: {
              fecha: new Date(),
              user: {
                _id: req.user._id,
                firstname: req.user.firstname,
                lastname: req.user.lastname,
              },
              accion: 'Consumo registrado',
              detalles: `Cantidad: ${quantity}, Centro: ${centro.name}, SAP Doc: ${sapResult.sapDocNum}`,
            },
          },
        };

        if (newQuantity === 0) {
          updateData.$set = { status: 'DEPLETED' };
        }

        await Lotes.findByIdAndUpdate(lote._id, updateData, { session });
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
          pushed: true,
          sapDocEntry: sapResult.sapDocEntry,
          sapDocNum: sapResult.sapDocNum,
          sapDocType: 'DeliveryNotes',
          pushedAt: new Date(),
          error: null,
        },
        notes,
        status: 'SYNCED',
        createdBy: {
          _id: req.user._id,
          firstname: req.user.firstname,
          lastname: req.user.lastname,
          email: req.user.email,
        },
      });

      await consumo.save({ session });

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
          { upsert: false, session }
        );
      }

      // Commit transaction
      await session.commitTransaction();

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
    } catch (localError) {
      // Local save failed after SAP succeeded
      // This is a critical error - SAP has the document but local doesn't
      await session.abortTransaction();
      console.error('CRITICAL: SAP succeeded but local save failed:', localError);
      console.error('SAP Document created:', sapResult);

      return res.status(500).json({
        success: false,
        error: 'Error guardando localmente después de crear documento SAP. Contacte soporte.',
        sapResult,
        localError: localError.message,
        requiresManualReconciliation: true,
      });
    } finally {
      session.endSession();
    }
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
 *
 * Uses optimistic locking to prevent duplicate SAP documents:
 * 1. Atomically claim the retry by setting status to 'RETRYING'
 * 2. If claim fails, another request is already processing
 * 3. Call SAP and update with result
 */
exports.retrySap = async (req, res, next) => {
  try {
    const { id } = req.params;

    const Consumos = await getConsumosModel(req.companyId);

    // Atomically claim the retry - only succeeds if not already synced or retrying
    const consumo = await Consumos.findOneAndUpdate(
      {
        _id: id,
        'sapSync.pushed': false,
        status: { $ne: 'RETRYING' },
      },
      {
        $set: { status: 'RETRYING' },
      },
      { new: true }
    );

    if (!consumo) {
      // Check why we couldn't claim it
      const existing = await Consumos.findById(id).lean();
      if (!existing) {
        return res.status(404).json({ error: 'Consumo no encontrado' });
      }
      if (existing.sapSync?.pushed) {
        return res.status(400).json({ error: 'Este consumo ya está sincronizado con SAP' });
      }
      if (existing.status === 'RETRYING') {
        return res.status(409).json({ error: 'Ya hay un reintento en progreso' });
      }
      return res.status(400).json({ error: 'No se pudo iniciar el reintento' });
    }

    // Get Centro for SAP customer code
    const Locaciones = await getLocacionesModel(req.companyId);
    const centro = await Locaciones.findById(consumo.centroId).lean();

    if (!centro?.sapIntegration?.cardCode) {
      // Release the lock
      await Consumos.findByIdAndUpdate(id, { $set: { status: 'FAILED' } });
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

      // Update with success
      await Consumos.findByIdAndUpdate(id, {
        $set: {
          'sapSync.pushed': true,
          'sapSync.sapDocEntry': deliveryResult.DocEntry,
          'sapSync.sapDocNum': deliveryResult.DocNum,
          'sapSync.sapDocType': 'DeliveryNotes',
          'sapSync.pushedAt': new Date(),
          'sapSync.error': null,
          status: 'SYNCED',
        },
      });

      res.json({
        success: true,
        sapResult: {
          sapDocEntry: deliveryResult.DocEntry,
          sapDocNum: deliveryResult.DocNum,
        },
      });
    } catch (sapError) {
      // Update with failure, release lock
      await Consumos.findByIdAndUpdate(id, {
        $set: {
          'sapSync.error': sapError.message,
          status: 'FAILED',
        },
      });

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
