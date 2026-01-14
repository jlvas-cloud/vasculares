/**
 * External Document Import Service
 * Validates and imports external SAP documents into local database
 */
const mongoose = require('mongoose');

/**
 * Validate if an external document can be imported
 * @param {string} companyId - Company ID
 * @param {string} documentId - External document ID
 * @returns {Object} Validation result with errors, dependencies, and preview
 */
async function validateImport(companyId, documentId) {
  const getModel = require('../getModel');
  const ExternalSapDocument = getModel(companyId, 'ExternalSapDocument');
  const Producto = getModel(companyId, 'Producto');
  const Locacion = getModel(companyId, 'Locacion');
  const Lote = getModel(companyId, 'Lote');

  // Get the document
  const doc = await ExternalSapDocument.findById(documentId);
  if (!doc) {
    return {
      canImport: false,
      errors: [{ type: 'NOT_FOUND', message: 'Documento no encontrado' }],
      dependencies: [],
      preview: null,
    };
  }

  // Check if already imported
  if (doc.status === 'IMPORTED') {
    return {
      canImport: false,
      errors: [{ type: 'ALREADY_IMPORTED', message: 'Este documento ya fue importado' }],
      dependencies: [],
      preview: null,
    };
  }

  const errors = [];
  const dependencies = [];
  const preview = {
    lotesToCreate: [],
    lotesToUpdate: [],
    inventoryChanges: [],
  };

  // Validate based on document type
  switch (doc.sapDocType) {
    case 'PurchaseDeliveryNote':
      await validatePurchaseDeliveryNote(doc, { Producto, Locacion, Lote, errors, preview });
      break;

    case 'StockTransfer':
      await validateStockTransfer(doc, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview });
      break;

    case 'DeliveryNote':
      await validateDeliveryNote(doc, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview });
      break;

    default:
      errors.push({
        type: 'UNKNOWN_TYPE',
        message: `Tipo de documento no soportado: ${doc.sapDocType}`,
      });
  }

  return {
    canImport: errors.length === 0,
    errors,
    dependencies,
    preview: errors.length === 0 ? preview : null,
  };
}

/**
 * Validate PurchaseDeliveryNote (Goods Receipt)
 * Creates new batches - no inventory dependency
 */
async function validatePurchaseDeliveryNote(doc, { Producto, Locacion, Lote, errors, preview }) {
  const lines = doc.rawData?.DocumentLines || [];

  for (const line of lines) {
    const itemCode = line.ItemCode;
    const warehouseCode = line.WarehouseCode;
    const batchNumbers = line.BatchNumbers || [];

    // 1. Check product exists
    const product = await Producto.findOne({ sapItemCode: itemCode, active: true });
    if (!product) {
      errors.push({
        type: 'MISSING_PRODUCT',
        message: `Producto ${itemCode} no existe en el sistema`,
        details: { itemCode },
      });
      continue;
    }

    // 2. Check location exists and is a warehouse
    const location = await Locacion.findOne({
      'sapIntegration.warehouseCode': warehouseCode,
    });
    if (!location) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Almacén ${warehouseCode} no está configurado`,
        details: { warehouseCode },
      });
      continue;
    }

    if (location.type !== 'WAREHOUSE') {
      errors.push({
        type: 'INVALID_LOCATION_TYPE',
        message: `Ubicación ${location.name} no es un almacén`,
        details: { warehouseCode, locationType: location.type },
      });
      continue;
    }

    // 3. Build preview for each batch
    for (const batch of batchNumbers) {
      const existingLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: location._id,
      });

      if (existingLote) {
        preview.lotesToUpdate.push({
          loteId: existingLote._id,
          lotNumber: batch.BatchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: location.name,
          currentQuantity: existingLote.quantity,
          addQuantity: batch.Quantity,
          newQuantity: existingLote.quantity + batch.Quantity,
        });
      } else {
        preview.lotesToCreate.push({
          lotNumber: batch.BatchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: location.name,
          quantity: batch.Quantity,
          expiryDate: batch.ExpiryDate,
        });
      }

      preview.inventoryChanges.push({
        productCode: itemCode,
        productName: product.name,
        locationName: location.name,
        change: `+${batch.Quantity}`,
      });
    }
  }
}

/**
 * Validate StockTransfer
 * Requires batch to exist in source location
 */
async function validateStockTransfer(doc, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview }) {
  const lines = doc.rawData?.StockTransferLines || [];

  for (const line of lines) {
    const itemCode = line.ItemCode;
    const fromWarehouse = line.FromWarehouseCode;
    const toWarehouse = line.WarehouseCode;
    const batchNumbers = line.BatchNumbers || [];

    // 1. Check product exists
    const product = await Producto.findOne({ sapItemCode: itemCode, active: true });
    if (!product) {
      errors.push({
        type: 'MISSING_PRODUCT',
        message: `Producto ${itemCode} no existe en el sistema`,
        details: { itemCode },
      });
      continue;
    }

    // 2. Check source location exists
    const fromLocation = await findLocationByWarehouseOrBin(Locacion, fromWarehouse, line.FromBinAbsEntry);
    if (!fromLocation) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Almacén origen ${fromWarehouse} no está configurado`,
        details: { warehouseCode: fromWarehouse },
      });
      continue;
    }

    // 3. Check destination location exists
    const toLocation = await findLocationByWarehouseOrBin(Locacion, toWarehouse, line.BinAbsEntry);
    if (!toLocation) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Almacén destino ${toWarehouse} no está configurado`,
        details: { warehouseCode: toWarehouse },
      });
      continue;
    }

    // 4. Check each batch exists in source with sufficient quantity
    for (const batch of batchNumbers) {
      const sourceLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: fromLocation._id,
      });

      if (!sourceLote) {
        // Check if there's a pending document that would create this batch
        const dependencyDoc = await findDependencyDocument(
          ExternalSapDocument,
          itemCode,
          batch.BatchNumber,
          fromLocation,
          'PurchaseDeliveryNote'
        );

        if (dependencyDoc) {
          dependencies.push({
            docId: dependencyDoc._id,
            sapDocNum: dependencyDoc.sapDocNum,
            sapDocType: dependencyDoc.sapDocType,
            message: `Este documento crearía el lote ${batch.BatchNumber} faltante`,
          });
        }

        errors.push({
          type: 'MISSING_BATCH',
          message: `Lote ${batch.BatchNumber} no existe en ${fromLocation.name}`,
          details: { batch: batch.BatchNumber, location: fromLocation.name },
        });
        continue;
      }

      if (sourceLote.quantity < batch.Quantity) {
        errors.push({
          type: 'INSUFFICIENT_QUANTITY',
          message: `Lote ${batch.BatchNumber} solo tiene ${sourceLote.quantity} unidades, se requieren ${batch.Quantity}`,
          details: {
            batch: batch.BatchNumber,
            available: sourceLote.quantity,
            required: batch.Quantity,
          },
        });
        continue;
      }

      // Build preview
      const destLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: toLocation._id,
      });

      preview.lotesToUpdate.push({
        loteId: sourceLote._id,
        lotNumber: batch.BatchNumber,
        productCode: itemCode,
        productName: product.name,
        locationName: fromLocation.name,
        currentQuantity: sourceLote.quantity,
        addQuantity: -batch.Quantity,
        newQuantity: sourceLote.quantity - batch.Quantity,
      });

      if (destLote) {
        preview.lotesToUpdate.push({
          loteId: destLote._id,
          lotNumber: batch.BatchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: toLocation.name,
          currentQuantity: destLote.quantity,
          addQuantity: batch.Quantity,
          newQuantity: destLote.quantity + batch.Quantity,
        });
      } else {
        preview.lotesToCreate.push({
          lotNumber: batch.BatchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: toLocation.name,
          quantity: batch.Quantity,
        });
      }

      preview.inventoryChanges.push({
        productCode: itemCode,
        productName: product.name,
        fromLocation: fromLocation.name,
        toLocation: toLocation.name,
        quantity: batch.Quantity,
      });
    }
  }
}

/**
 * Validate DeliveryNote (Consumption)
 * Requires batch to exist with sufficient quantity
 */
async function validateDeliveryNote(doc, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview }) {
  const lines = doc.rawData?.DocumentLines || [];

  for (const line of lines) {
    const itemCode = line.ItemCode;
    const warehouseCode = line.WarehouseCode;
    const batchNumbers = line.BatchNumbers || [];

    // 1. Check product exists
    const product = await Producto.findOne({ sapItemCode: itemCode, active: true });
    if (!product) {
      errors.push({
        type: 'MISSING_PRODUCT',
        message: `Producto ${itemCode} no existe en el sistema`,
        details: { itemCode },
      });
      continue;
    }

    // 2. Check location exists
    const location = await findLocationByWarehouseOrBin(Locacion, warehouseCode, line.BinAbsEntry);
    if (!location) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Ubicación ${warehouseCode} no está configurada`,
        details: { warehouseCode },
      });
      continue;
    }

    // 3. Check each batch exists with sufficient quantity
    for (const batch of batchNumbers) {
      const lote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: location._id,
      });

      if (!lote) {
        // Check for dependency documents
        const transferDoc = await findDependencyDocument(
          ExternalSapDocument,
          itemCode,
          batch.BatchNumber,
          location,
          'StockTransfer'
        );

        if (transferDoc) {
          dependencies.push({
            docId: transferDoc._id,
            sapDocNum: transferDoc.sapDocNum,
            sapDocType: transferDoc.sapDocType,
            message: `Este documento trasladaría el lote ${batch.BatchNumber} a ${location.name}`,
          });
        }

        errors.push({
          type: 'MISSING_BATCH',
          message: `Lote ${batch.BatchNumber} no existe en ${location.name}`,
          details: { batch: batch.BatchNumber, location: location.name },
        });
        continue;
      }

      if (lote.quantity < batch.Quantity) {
        errors.push({
          type: 'INSUFFICIENT_QUANTITY',
          message: `Lote ${batch.BatchNumber} solo tiene ${lote.quantity} unidades`,
          details: {
            batch: batch.BatchNumber,
            available: lote.quantity,
            required: batch.Quantity,
          },
        });
        continue;
      }

      // Build preview
      preview.lotesToUpdate.push({
        loteId: lote._id,
        lotNumber: batch.BatchNumber,
        productCode: itemCode,
        productName: product.name,
        locationName: location.name,
        currentQuantity: lote.quantity,
        addQuantity: -batch.Quantity,
        newQuantity: lote.quantity - batch.Quantity,
      });

      preview.inventoryChanges.push({
        productCode: itemCode,
        productName: product.name,
        locationName: location.name,
        change: `-${batch.Quantity}`,
      });
    }
  }
}

/**
 * Find location by warehouse code or bin entry
 */
async function findLocationByWarehouseOrBin(Locacion, warehouseCode, binAbsEntry) {
  // First try to find by bin (more specific)
  if (binAbsEntry) {
    const byBin = await Locacion.findOne({
      'sapIntegration.binAbsEntry': binAbsEntry,
    });
    if (byBin) return byBin;
  }

  // Fall back to warehouse code
  return Locacion.findOne({
    'sapIntegration.warehouseCode': warehouseCode,
  });
}

/**
 * Find a pending document that could create the missing batch
 */
async function findDependencyDocument(ExternalSapDocument, itemCode, batchNumber, targetLocation, expectedDocType) {
  const pendingDocs = await ExternalSapDocument.find({
    status: 'PENDING_REVIEW',
    sapDocType: expectedDocType,
  });

  for (const doc of pendingDocs) {
    const lines = doc.rawData?.DocumentLines || doc.rawData?.StockTransferLines || [];

    for (const line of lines) {
      if (line.ItemCode !== itemCode) continue;

      const batches = line.BatchNumbers || [];
      for (const batch of batches) {
        if (batch.BatchNumber === batchNumber) {
          // For StockTransfer, check if destination matches target location
          if (expectedDocType === 'StockTransfer') {
            // Check if this transfer's destination is our target location
            if (line.WarehouseCode === targetLocation.sapIntegration?.warehouseCode ||
                line.BinAbsEntry === targetLocation.sapIntegration?.binAbsEntry) {
              return doc;
            }
          } else {
            // For PurchaseDeliveryNote, any match on batch is good
            return doc;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Import an external document after validation passes
 * @param {string} companyId - Company ID
 * @param {string} documentId - External document ID
 * @param {Object} user - User performing the import
 * @returns {Object} Import result
 */
async function importDocument(companyId, documentId, user) {
  const getModel = require('../getModel');
  const ExternalSapDocument = getModel(companyId, 'ExternalSapDocument');
  const Producto = getModel(companyId, 'Producto');
  const Locacion = getModel(companyId, 'Locacion');
  const Lote = getModel(companyId, 'Lote');
  const Inventario = getModel(companyId, 'Inventario');
  const GoodsReceipt = getModel(companyId, 'GoodsReceipt');
  const Consignacion = getModel(companyId, 'Consignacion');
  const Consumo = getModel(companyId, 'Consumo');

  // First validate
  const validation = await validateImport(companyId, documentId);
  if (!validation.canImport) {
    return {
      success: false,
      errors: validation.errors,
      message: 'No se puede importar: hay errores de validación',
    };
  }

  const doc = await ExternalSapDocument.findById(documentId);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    let result;
    switch (doc.sapDocType) {
      case 'PurchaseDeliveryNote':
        result = await importPurchaseDeliveryNote(doc, {
          Producto, Locacion, Lote, Inventario, GoodsReceipt, user, session,
        });
        break;

      case 'StockTransfer':
        result = await importStockTransfer(doc, {
          Producto, Locacion, Lote, Inventario, Consignacion, user, session,
        });
        break;

      case 'DeliveryNote':
        result = await importDeliveryNote(doc, {
          Producto, Locacion, Lote, Inventario, Consumo, user, session,
        });
        break;

      default:
        throw new Error(`Tipo de documento no soportado: ${doc.sapDocType}`);
    }

    // Mark document as imported
    doc.status = 'IMPORTED';
    doc.processedBy = user;
    doc.processedAt = new Date();
    doc.processingNotes = `Importado desde SAP. ${result.summary}`;
    await doc.save({ session });

    await session.commitTransaction();

    return {
      success: true,
      created: result.created,
      message: 'Documento importado exitosamente',
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Import PurchaseDeliveryNote (creates Lotes, updates Inventario, creates GoodsReceipt)
 */
async function importPurchaseDeliveryNote(doc, { Producto, Locacion, Lote, Inventario, GoodsReceipt, user, session }) {
  const lines = doc.rawData?.DocumentLines || [];
  const created = { lotes: 0, inventario: 0, goodsReceipt: 0 };
  const lotesCreated = [];

  for (const line of lines) {
    const product = await Producto.findOne({ sapItemCode: line.ItemCode, active: true });
    const location = await Locacion.findOne({
      'sapIntegration.warehouseCode': line.WarehouseCode,
    });

    for (const batch of (line.BatchNumbers || [])) {
      // Find or create lote
      let lote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: location._id,
      }).session(session);

      if (lote) {
        // Update existing lote
        lote.quantity += batch.Quantity;
        lote.historia.push({
          action: 'IMPORT_SAP',
          quantity: batch.Quantity,
          notes: `Importado desde SAP Doc ${doc.sapDocNum}`,
          performedBy: user,
          createdAt: new Date(),
        });
        await lote.save({ session });
      } else {
        // Create new lote
        lote = new Lote({
          productId: product._id,
          lotNumber: batch.BatchNumber,
          currentLocationId: location._id,
          quantity: batch.Quantity,
          expiryDate: batch.ExpiryDate ? new Date(batch.ExpiryDate) : null,
          status: 'DISPONIBLE',
          historia: [{
            action: 'IMPORT_SAP',
            quantity: batch.Quantity,
            notes: `Importado desde SAP Doc ${doc.sapDocNum}`,
            performedBy: user,
            createdAt: new Date(),
          }],
        });
        await lote.save({ session });
        created.lotes++;
      }

      lotesCreated.push({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        quantity: batch.Quantity,
      });

      // Update inventario
      await updateInventario(Inventario, product._id, location._id, batch.Quantity, session);
      created.inventario++;
    }
  }

  // Create GoodsReceipt record
  const goodsReceipt = new GoodsReceipt({
    date: doc.rawData?.DocDate ? new Date(doc.rawData.DocDate) : new Date(),
    locationId: (await Locacion.findOne({ 'sapIntegration.warehouseCode': lines[0]?.WarehouseCode }))?._id,
    supplierId: doc.rawData?.CardCode,
    items: lotesCreated.map(l => ({
      productId: l.productId,
      lotNumber: l.lotNumber,
      quantity: l.quantity,
    })),
    sapIntegration: {
      docEntry: doc.sapDocEntry,
      docNum: doc.sapDocNum,
      status: 'SYNCED',
      syncedAt: new Date(),
    },
    status: 'RECIBIDO',
    notes: `Importado desde documento externo SAP ${doc.sapDocNum}`,
    createdBy: user,
  });
  await goodsReceipt.save({ session });
  created.goodsReceipt = 1;

  return {
    created,
    summary: `${created.lotes} lotes creados, ${created.goodsReceipt} entrada de mercancía`,
  };
}

/**
 * Import StockTransfer (updates Lotes, creates Consignacion)
 */
async function importStockTransfer(doc, { Producto, Locacion, Lote, Inventario, Consignacion, user, session }) {
  const lines = doc.rawData?.StockTransferLines || [];
  const created = { lotesUpdated: 0, lotesCreated: 0, consignacion: 0 };
  const items = [];

  for (const line of lines) {
    const product = await Producto.findOne({ sapItemCode: line.ItemCode, active: true });
    const fromLocation = await findLocationByWarehouseOrBin(Locacion, line.FromWarehouseCode, line.FromBinAbsEntry);
    const toLocation = await findLocationByWarehouseOrBin(Locacion, line.WarehouseCode, line.BinAbsEntry);

    for (const batch of (line.BatchNumbers || [])) {
      // Reduce from source
      const sourceLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: fromLocation._id,
      }).session(session);

      sourceLote.quantity -= batch.Quantity;
      sourceLote.historia.push({
        action: 'TRANSFER_OUT_SAP',
        quantity: -batch.Quantity,
        toLocationId: toLocation._id,
        notes: `Traslado importado desde SAP Doc ${doc.sapDocNum}`,
        performedBy: user,
        createdAt: new Date(),
      });
      await sourceLote.save({ session });
      created.lotesUpdated++;

      // Add to destination
      let destLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: toLocation._id,
      }).session(session);

      if (destLote) {
        destLote.quantity += batch.Quantity;
        destLote.historia.push({
          action: 'TRANSFER_IN_SAP',
          quantity: batch.Quantity,
          fromLocationId: fromLocation._id,
          notes: `Traslado importado desde SAP Doc ${doc.sapDocNum}`,
          performedBy: user,
          createdAt: new Date(),
        });
        await destLote.save({ session });
        created.lotesUpdated++;
      } else {
        destLote = new Lote({
          productId: product._id,
          lotNumber: batch.BatchNumber,
          currentLocationId: toLocation._id,
          quantity: batch.Quantity,
          expiryDate: sourceLote.expiryDate,
          status: 'DISPONIBLE',
          historia: [{
            action: 'TRANSFER_IN_SAP',
            quantity: batch.Quantity,
            fromLocationId: fromLocation._id,
            notes: `Traslado importado desde SAP Doc ${doc.sapDocNum}`,
            performedBy: user,
            createdAt: new Date(),
          }],
        });
        await destLote.save({ session });
        created.lotesCreated++;
      }

      // Update inventario for both locations
      await updateInventario(Inventario, product._id, fromLocation._id, -batch.Quantity, session);
      await updateInventario(Inventario, product._id, toLocation._id, batch.Quantity, session);

      items.push({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        quantity: batch.Quantity,
      });
    }
  }

  // Create Consignacion record
  const fromLocation = await findLocationByWarehouseOrBin(Locacion, lines[0]?.FromWarehouseCode, lines[0]?.FromBinAbsEntry);
  const toLocation = await findLocationByWarehouseOrBin(Locacion, lines[0]?.WarehouseCode, lines[0]?.BinAbsEntry);

  const consignacion = new Consignacion({
    date: doc.rawData?.DocDate ? new Date(doc.rawData.DocDate) : new Date(),
    fromLocationId: fromLocation?._id,
    toLocationId: toLocation?._id,
    items: items.map(i => ({
      productId: i.productId,
      lotNumber: i.lotNumber,
      quantity: i.quantity,
    })),
    sapIntegration: {
      docEntry: doc.sapDocEntry,
      docNum: doc.sapDocNum,
      status: 'SYNCED',
      syncedAt: new Date(),
    },
    status: 'RECIBIDO',
    notes: `Importado desde documento externo SAP ${doc.sapDocNum}`,
    createdBy: user,
  });
  await consignacion.save({ session });
  created.consignacion = 1;

  return {
    created,
    summary: `${created.lotesUpdated} lotes actualizados, ${created.lotesCreated} lotes creados, ${created.consignacion} consignación`,
  };
}

/**
 * Import DeliveryNote (reduces Lotes, creates Consumo)
 */
async function importDeliveryNote(doc, { Producto, Locacion, Lote, Inventario, Consumo, user, session }) {
  const lines = doc.rawData?.DocumentLines || [];
  const created = { lotesUpdated: 0, consumo: 0 };
  const items = [];

  for (const line of lines) {
    const product = await Producto.findOne({ sapItemCode: line.ItemCode, active: true });
    const location = await findLocationByWarehouseOrBin(Locacion, line.WarehouseCode, line.BinAbsEntry);

    for (const batch of (line.BatchNumbers || [])) {
      const lote = await Lote.findOne({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        currentLocationId: location._id,
      }).session(session);

      lote.quantity -= batch.Quantity;
      lote.historia.push({
        action: 'CONSUMPTION_SAP',
        quantity: -batch.Quantity,
        notes: `Consumo importado desde SAP Doc ${doc.sapDocNum}`,
        performedBy: user,
        createdAt: new Date(),
      });
      await lote.save({ session });
      created.lotesUpdated++;

      // Update inventario
      await updateInventario(Inventario, product._id, location._id, -batch.Quantity, session);

      items.push({
        productId: product._id,
        lotNumber: batch.BatchNumber,
        quantity: batch.Quantity,
      });
    }
  }

  // Create Consumo record
  const location = await findLocationByWarehouseOrBin(Locacion, lines[0]?.WarehouseCode, lines[0]?.BinAbsEntry);

  const consumo = new Consumo({
    date: doc.rawData?.DocDate ? new Date(doc.rawData.DocDate) : new Date(),
    locationId: location?._id,
    patientId: doc.rawData?.U_PatientId,
    items: items.map(i => ({
      productId: i.productId,
      lotNumber: i.lotNumber,
      quantity: i.quantity,
    })),
    sapIntegration: {
      docEntry: doc.sapDocEntry,
      docNum: doc.sapDocNum,
      status: 'SYNCED',
      syncedAt: new Date(),
    },
    status: 'SYNCED',
    notes: `Importado desde documento externo SAP ${doc.sapDocNum}`,
    createdBy: user,
  });
  await consumo.save({ session });
  created.consumo = 1;

  return {
    created,
    summary: `${created.lotesUpdated} lotes actualizados, ${created.consumo} consumo`,
  };
}

/**
 * Update inventario aggregation
 */
async function updateInventario(Inventario, productId, locationId, quantityChange, session) {
  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $inc: { 'quantities.available': quantityChange, 'quantities.total': quantityChange },
      $set: { lastUpdated: new Date() },
    },
    { upsert: true, session }
  );
}

module.exports = {
  validateImport,
  importDocument,
};
