/**
 * External Document Import Service
 * Validates and imports external SAP documents into local database
 */
const {
  getProductosModel,
  getLocacionesModel,
  getLotesModel,
  getInventarioModel,
  getExternalSapDocumentsModel,
  getGoodsReceiptsModel,
  getConsignacionesModel,
  getConsumosModel,
} = require('../getModel');

const { getStockTransferByDocEntry } = require('./sapService');

/**
 * Validate if an external document can be imported
 * @param {string} companyId - Company ID
 * @param {string} documentId - External document ID
 * @returns {Object} Validation result with errors, dependencies, and preview
 */
async function validateImport(companyId, documentId) {
  const ExternalSapDocument = await getExternalSapDocumentsModel(companyId);
  const Producto = await getProductosModel(companyId);
  const Locacion = await getLocacionesModel(companyId);
  const Lote = await getLotesModel(companyId);

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

  // Items are stored flat: one record per item/batch combination
  const items = doc.items || [];

  // Validate based on document type
  switch (doc.sapDocType) {
    case 'PurchaseDeliveryNote':
      await validatePurchaseDeliveryNote(items, { Producto, Locacion, Lote, errors, preview });
      break;

    case 'StockTransfer':
      await validateStockTransfer(items, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview, companyId, sapCardCode: doc.sapCardCode, sapDocEntry: doc.sapDocEntry });
      break;

    case 'DeliveryNote':
      await validateDeliveryNote(items, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview, companyId });
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
async function validatePurchaseDeliveryNote(items, { Producto, Locacion, Lote, errors, preview }) {
  for (const item of items) {
    const itemCode = item.sapItemCode;
    const warehouseCode = item.warehouseCode;
    const batchNumber = item.batchNumber;
    const quantity = item.quantity;

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
    const location = await findLocationByWarehouseOrBin(Locacion, warehouseCode, item.binAbsEntry);
    if (!location) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Almacén ${warehouseCode} no está configurado`,
        details: { warehouseCode },
      });
      continue;
    }

    // 3. Build preview
    if (batchNumber) {
      const existingLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batchNumber,
        currentLocationId: location._id,
      });

      if (existingLote) {
        preview.lotesToUpdate.push({
          loteId: existingLote._id,
          lotNumber: batchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: location.name,
          currentQuantity: existingLote.quantityAvailable,
          addQuantity: quantity,
          newQuantity: existingLote.quantityAvailable + quantity,
        });
      } else {
        preview.lotesToCreate.push({
          lotNumber: batchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: location.name,
          quantity: quantity,
        });
      }
    }

    preview.inventoryChanges.push({
      productCode: itemCode,
      productName: product.name,
      locationName: location.name,
      change: `+${quantity}`,
    });
  }
}

/**
 * Validate StockTransfer
 * Requires batch to exist in source location
 */
async function validateStockTransfer(items, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview, companyId, sapCardCode, sapDocEntry }) {
  // Fetch fresh data from SAP to get bin allocations for accurate validation
  let validationItems = items;
  let validationCardCode = sapCardCode;

  if (sapDocEntry) {
    const freshResult = await getStockTransferByDocEntry(sapDocEntry);
    if (freshResult.success && freshResult.document) {
      validationItems = freshResult.document.items;
      validationCardCode = freshResult.document.sapCardCode;
    } else {
      console.warn(`[Validation] Could not fetch fresh SAP data for StockTransfer ${sapDocEntry}, using stored data`);
    }
  }

  for (const item of validationItems) {
    const itemCode = item.sapItemCode;
    const fromWarehouse = item.fromWarehouseCode;
    const toWarehouse = item.toWarehouseCode;
    const batchNumber = item.batchNumber;
    const quantity = item.quantity;

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
    const fromLocation = await findLocationByWarehouseOrBin(Locacion, fromWarehouse, item.fromBinAbsEntry);
    if (!fromLocation) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Almacén origen ${fromWarehouse} no está configurado`,
        details: { warehouseCode: fromWarehouse },
      });
      continue;
    }

    // 3. Check destination location exists (try bin, then cardCode, then warehouse)
    let toLocation = null;
    if (item.toBinAbsEntry) {
      toLocation = await findLocationByWarehouseOrBin(Locacion, toWarehouse, item.toBinAbsEntry);
    }
    if (!toLocation && validationCardCode) {
      toLocation = await findLocationByCardCode(Locacion, validationCardCode);
    }
    if (!toLocation) {
      toLocation = await findLocationByWarehouseOrBin(Locacion, toWarehouse, null);
    }
    if (!toLocation) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Almacén destino ${toWarehouse} no está configurado`,
        details: { warehouseCode: toWarehouse },
      });
      continue;
    }

    // 4. Check batch exists in source with sufficient quantity (if batch tracked)
    if (batchNumber) {
      const sourceLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batchNumber,
        currentLocationId: fromLocation._id,
      });

      if (!sourceLote) {
        // Check if there's a pending document that would create this batch
        const dependencyDoc = await findDependencyDocument(
          ExternalSapDocument,
          itemCode,
          batchNumber,
          fromLocation,
          'PurchaseDeliveryNote',
          companyId
        );

        if (dependencyDoc) {
          dependencies.push({
            docId: dependencyDoc._id,
            sapDocNum: dependencyDoc.sapDocNum,
            sapDocType: dependencyDoc.sapDocType,
            message: `Este documento crearía el lote ${batchNumber} faltante`,
          });
        }

        errors.push({
          type: 'MISSING_BATCH',
          message: `Lote ${batchNumber} no existe en ${fromLocation.name}`,
          details: { batch: batchNumber, location: fromLocation.name },
        });
        continue;
      }

      if (sourceLote.quantityAvailable < quantity) {
        errors.push({
          type: 'INSUFFICIENT_QUANTITY',
          message: `Lote ${batchNumber} solo tiene ${sourceLote.quantityAvailable} unidades, se requieren ${quantity}`,
          details: {
            batch: batchNumber,
            available: sourceLote.quantityAvailable,
            required: quantity,
          },
        });
        continue;
      }

      // Build preview
      const destLote = await Lote.findOne({
        productId: product._id,
        lotNumber: batchNumber,
        currentLocationId: toLocation._id,
      });

      preview.lotesToUpdate.push({
        loteId: sourceLote._id,
        lotNumber: batchNumber,
        productCode: itemCode,
        productName: product.name,
        locationName: fromLocation.name,
        currentQuantity: sourceLote.quantityAvailable,
        addQuantity: -quantity,
        newQuantity: sourceLote.quantityAvailable - quantity,
      });

      if (destLote) {
        preview.lotesToUpdate.push({
          loteId: destLote._id,
          lotNumber: batchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: toLocation.name,
          currentQuantity: destLote.quantityAvailable,
          addQuantity: quantity,
          newQuantity: destLote.quantityAvailable + quantity,
        });
      } else {
        preview.lotesToCreate.push({
          lotNumber: batchNumber,
          productCode: itemCode,
          productName: product.name,
          locationName: toLocation.name,
          quantity: quantity,
        });
      }
    }

    preview.inventoryChanges.push({
      productCode: itemCode,
      productName: product.name,
      fromLocation: fromLocation.name,
      toLocation: toLocation.name,
      quantity: quantity,
    });
  }
}

/**
 * Validate DeliveryNote (Consumption)
 * Requires batch to exist with sufficient quantity
 */
async function validateDeliveryNote(items, { Producto, Locacion, Lote, ExternalSapDocument, errors, dependencies, preview, companyId }) {
  for (const item of items) {
    const itemCode = item.sapItemCode;
    const warehouseCode = item.warehouseCode;
    const batchNumber = item.batchNumber;
    const quantity = item.quantity;

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
    const location = await findLocationByWarehouseOrBin(Locacion, warehouseCode, item.binAbsEntry);
    if (!location) {
      errors.push({
        type: 'MISSING_LOCATION',
        message: `Ubicación ${warehouseCode} no está configurada`,
        details: { warehouseCode },
      });
      continue;
    }

    // 3. Check batch exists with sufficient quantity (if batch tracked)
    if (batchNumber) {
      const lote = await Lote.findOne({
        productId: product._id,
        lotNumber: batchNumber,
        currentLocationId: location._id,
      });

      if (!lote) {
        // Check for dependency documents
        const transferDoc = await findDependencyDocument(
          ExternalSapDocument,
          itemCode,
          batchNumber,
          location,
          'StockTransfer',
          companyId
        );

        if (transferDoc) {
          dependencies.push({
            docId: transferDoc._id,
            sapDocNum: transferDoc.sapDocNum,
            sapDocType: transferDoc.sapDocType,
            message: `Este documento trasladaría el lote ${batchNumber} a ${location.name}`,
          });
        }

        errors.push({
          type: 'MISSING_BATCH',
          message: `Lote ${batchNumber} no existe en ${location.name}`,
          details: { batch: batchNumber, location: location.name },
        });
        continue;
      }

      if (lote.quantityAvailable < quantity) {
        errors.push({
          type: 'INSUFFICIENT_QUANTITY',
          message: `Lote ${batchNumber} solo tiene ${lote.quantityAvailable} unidades`,
          details: {
            batch: batchNumber,
            available: lote.quantityAvailable,
            required: quantity,
          },
        });
        continue;
      }

      // Build preview
      preview.lotesToUpdate.push({
        loteId: lote._id,
        lotNumber: batchNumber,
        productCode: itemCode,
        productName: product.name,
        locationName: location.name,
        currentQuantity: lote.quantityAvailable,
        addQuantity: -quantity,
        newQuantity: lote.quantityAvailable - quantity,
      });
    }

    preview.inventoryChanges.push({
      productCode: itemCode,
      productName: product.name,
      locationName: location.name,
      change: `-${quantity}`,
    });
  }
}

/**
 * Find location by warehouse code or bin entry
 */
async function findLocationByWarehouseOrBin(Locacion, warehouseCode, binAbsEntry) {
  // First try to find by bin (most specific)
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
 * Find location by cardCode (for transfers where bin is not specified)
 */
async function findLocationByCardCode(Locacion, cardCode) {
  if (!cardCode) return null;
  return Locacion.findOne({
    'sapIntegration.cardCode': cardCode,
  });
}

/**
 * Find a pending document that could create the missing batch
 */
async function findDependencyDocument(ExternalSapDocument, itemCode, batchNumber, targetLocation, expectedDocType, companyId) {
  const pendingDocs = await ExternalSapDocument.find({
    status: 'PENDING_REVIEW',
    sapDocType: expectedDocType,
    companyId,
  });

  for (const doc of pendingDocs) {
    for (const item of doc.items || []) {
      if (item.sapItemCode !== itemCode) continue;
      if (item.batchNumber !== batchNumber) continue;

      // For StockTransfer, check if destination matches target location
      if (expectedDocType === 'StockTransfer') {
        if (item.toWarehouseCode === targetLocation.sapIntegration?.warehouseCode ||
            item.toBinAbsEntry === targetLocation.sapIntegration?.binAbsEntry) {
          return doc;
        }
      } else {
        // For PurchaseDeliveryNote, any match on batch is good
        return doc;
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
  const ExternalSapDocument = await getExternalSapDocumentsModel(companyId);
  const Producto = await getProductosModel(companyId);
  const Locacion = await getLocacionesModel(companyId);
  const Lote = await getLotesModel(companyId);
  const Inventario = await getInventarioModel(companyId);
  const GoodsReceipt = await getGoodsReceiptsModel(companyId);
  const Consignacion = await getConsignacionesModel(companyId);
  const Consumo = await getConsumosModel(companyId);

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

  try {
    let result;
    switch (doc.sapDocType) {
      case 'PurchaseDeliveryNote':
        result = await importPurchaseDeliveryNote(doc, {
          Producto, Locacion, Lote, Inventario, GoodsReceipt, user,
        });
        break;

      case 'StockTransfer':
        result = await importStockTransfer(doc, {
          Producto, Locacion, Lote, Inventario, Consignacion, user,
        });
        break;

      case 'DeliveryNote':
        result = await importDeliveryNote(doc, {
          Producto, Locacion, Lote, Inventario, Consumo, user,
        });
        break;

      default:
        throw new Error(`Tipo de documento no soportado: ${doc.sapDocType}`);
    }

    // Mark document as imported
    doc.status = 'IMPORTED';
    doc.reviewedBy = user;
    doc.reviewedAt = new Date();
    doc.notes = `Importado desde SAP. ${result.summary}`;
    doc.importedAs = result.importedAs;
    await doc.save();

    return {
      success: true,
      created: result.created,
      message: 'Documento importado exitosamente',
    };
  } catch (error) {
    console.error('Error importing document:', error);
    throw error;
  }
}

/**
 * Import PurchaseDeliveryNote (creates Lotes, updates Inventario, creates GoodsReceipt)
 */
async function importPurchaseDeliveryNote(doc, { Producto, Locacion, Lote, Inventario, GoodsReceipt, user }) {
  const items = doc.items || [];
  const created = { lotes: 0, inventario: 0, goodsReceipt: 0 };
  const lotesCreated = [];
  let firstLocation = null;

  for (const item of items) {
    const product = await Producto.findOne({ sapItemCode: item.sapItemCode, active: true });
    const location = await findLocationByWarehouseOrBin(Locacion, item.warehouseCode, item.binAbsEntry);

    if (!firstLocation) firstLocation = location;

    if (!item.batchNumber) {
      // No batch tracking - just update inventory
      await updateInventario(Inventario, product._id, location._id, item.quantity);
      created.inventario++;
      lotesCreated.push({
        productId: product._id,
        productName: product.name,
        sapItemCode: item.sapItemCode,
        lotNumber: null,
        quantity: item.quantity,
        loteId: null,
        expiryDate: null,
      });
      continue;
    }

    // Find or create lote
    let lote = await Lote.findOne({
      productId: product._id,
      lotNumber: item.batchNumber,
      currentLocationId: location._id,
    });

    if (lote) {
      // Update existing lote
      lote.quantityTotal += item.quantity;
      lote.quantityAvailable += item.quantity;
      lote.historia.push({
        fecha: new Date(),
        user: user ? { _id: user._id, firstname: user.firstname, lastname: user.lastname } : null,
        accion: 'Importación SAP',
        detalles: `Cantidad: ${item.quantity}, SAP Doc: ${doc.sapDocNum}`,
      });
      await lote.save();
    } else {
      // Create new lote
      lote = new Lote({
        productId: product._id,
        lotNumber: item.batchNumber,
        currentLocationId: location._id,
        quantityTotal: item.quantity,
        quantityAvailable: item.quantity,
        expiryDate: new Date('2099-12-31'), // Default for imports without expiry info
        receivedDate: doc.sapDocDate || new Date(),
        status: 'ACTIVE',
        historia: [{
          fecha: new Date(),
          user: user ? { _id: user._id, firstname: user.firstname, lastname: user.lastname } : null,
          accion: 'Lote importado desde SAP',
          detalles: `Cantidad: ${item.quantity}, SAP Doc: ${doc.sapDocNum}`,
        }],
      });
      await lote.save();
      created.lotes++;
    }

    lotesCreated.push({
      productId: product._id,
      productName: product.name,
      sapItemCode: item.sapItemCode,
      lotNumber: item.batchNumber,
      quantity: item.quantity,
      loteId: lote._id,
      expiryDate: lote.expiryDate,
    });

    // Update inventario
    await updateInventario(Inventario, product._id, location._id, item.quantity);
    created.inventario++;
  }

  // Create GoodsReceipt record
  const goodsReceipt = new GoodsReceipt({
    receiptDate: doc.sapDocDate || new Date(),
    locationId: firstLocation?._id,
    locationName: firstLocation?.name,
    sapWarehouseCode: firstLocation?.sapIntegration?.warehouseCode,
    items: lotesCreated.map(l => ({
      productId: l.productId,
      productName: l.productName,
      sapItemCode: l.sapItemCode,
      lotNumber: l.lotNumber || 'SIN-LOTE',
      quantity: l.quantity,
      expiryDate: l.expiryDate || new Date('2099-12-31'), // Default for imports without expiry
      loteId: l.loteId,
    })),
    sapIntegration: {
      pushed: true,
      status: 'SYNCED',
      docEntry: doc.sapDocEntry,
      docNum: doc.sapDocNum,
      docType: 'PurchaseDeliveryNotes',
      syncDate: new Date(),
      error: null,
      retryCount: 0,
      retrying: false,
    },
    notes: `Importado desde documento externo SAP ${doc.sapDocNum}`,
    createdBy: user,
  });
  await goodsReceipt.save();
  created.goodsReceipt = 1;

  return {
    created,
    summary: `${created.lotes} lotes creados, ${created.goodsReceipt} entrada de mercancía`,
    importedAs: {
      documentType: 'GoodsReceipt',
      documentId: goodsReceipt._id,
    },
  };
}

/**
 * Import StockTransfer (updates Lotes, creates Consignacion)
 */
async function importStockTransfer(doc, { Producto, Locacion, Lote, Inventario, Consignacion, user }) {
  // Fetch fresh data from SAP to get bin allocations (list queries don't include them)
  const freshResult = await getStockTransferByDocEntry(doc.sapDocEntry);
  let items = doc.items || [];
  let sapCardCode = doc.sapCardCode;

  if (freshResult.success && freshResult.document) {
    // Use fresh data with bin allocations
    items = freshResult.document.items;
    sapCardCode = freshResult.document.sapCardCode;
    console.log(`[Import] Fetched fresh SAP data for StockTransfer ${doc.sapDocEntry}, found ${items.length} items with bin data`);
  } else {
    console.warn(`[Import] Could not fetch fresh SAP data for StockTransfer ${doc.sapDocEntry}, using stored data: ${freshResult.error}`);
  }

  const created = { lotesUpdated: 0, lotesCreated: 0, consignacion: 0 };
  const transferItems = [];
  let firstFromLocation = null;
  let firstToLocation = null;

  for (const item of items) {
    const product = await Producto.findOne({ sapItemCode: item.sapItemCode, active: true });
    const fromLocation = await findLocationByWarehouseOrBin(Locacion, item.fromWarehouseCode, item.fromBinAbsEntry);

    // For destination: try bin first (from fresh SAP data), then cardCode, then warehouse
    let toLocation = null;
    if (item.toBinAbsEntry) {
      toLocation = await findLocationByWarehouseOrBin(Locacion, item.toWarehouseCode, item.toBinAbsEntry);
    }
    if (!toLocation && sapCardCode) {
      toLocation = await findLocationByCardCode(Locacion, sapCardCode);
    }
    if (!toLocation) {
      toLocation = await findLocationByWarehouseOrBin(Locacion, item.toWarehouseCode, null);
    }

    if (!firstFromLocation) firstFromLocation = fromLocation;
    if (!firstToLocation) firstToLocation = toLocation;

    if (!item.batchNumber) {
      // No batch tracking - just update inventory
      // Source: only decrease available (total stays same)
      await Inventario.findOneAndUpdate(
        { productId: product._id, locationId: fromLocation._id },
        {
          $inc: { quantityAvailable: -item.quantity },
          $set: { lastMovementDate: new Date() },
        },
        { upsert: true }
      );
      // Destination: increase both total and available (new stock)
      await updateInventario(Inventario, product._id, toLocation._id, item.quantity);
      transferItems.push({
        productId: product._id,
        lotNumber: null,
        quantity: item.quantity,
        destLoteId: null,
      });
      continue;
    }

    // Reduce from source
    const sourceLote = await Lote.findOne({
      productId: product._id,
      lotNumber: item.batchNumber,
      currentLocationId: fromLocation._id,
    });

    // Source lote: decrease available only (total stays same, it's "total ever received")
    sourceLote.quantityAvailable -= item.quantity;
    sourceLote.historia.push({
      fecha: new Date(),
      user: user ? { _id: user._id, firstname: user.firstname, lastname: user.lastname } : null,
      accion: 'Traslado salida (SAP)',
      detalles: `Cantidad: -${item.quantity}, Destino: ${toLocation.name}, SAP Doc: ${doc.sapDocNum}`,
    });
    await sourceLote.save();
    created.lotesUpdated++;

    // Add to destination
    let destLote = await Lote.findOne({
      productId: product._id,
      lotNumber: item.batchNumber,
      currentLocationId: toLocation._id,
    });

    if (destLote) {
      destLote.quantityTotal += item.quantity;
      destLote.quantityAvailable += item.quantity;
      destLote.historia.push({
        fecha: new Date(),
        user: user ? { _id: user._id, firstname: user.firstname, lastname: user.lastname } : null,
        accion: 'Traslado entrada (SAP)',
        detalles: `Cantidad: +${item.quantity}, Origen: ${fromLocation.name}, SAP Doc: ${doc.sapDocNum}`,
      });
      await destLote.save();
      created.lotesUpdated++;
    } else {
      destLote = new Lote({
        productId: product._id,
        lotNumber: item.batchNumber,
        currentLocationId: toLocation._id,
        quantityTotal: item.quantity,
        quantityAvailable: item.quantity,
        expiryDate: sourceLote.expiryDate,
        receivedDate: doc.sapDocDate || new Date(),
        status: 'ACTIVE',
        historia: [{
          fecha: new Date(),
          user: user ? { _id: user._id, firstname: user.firstname, lastname: user.lastname } : null,
          accion: 'Lote recibido por traslado (SAP)',
          detalles: `Cantidad: ${item.quantity}, Origen: ${fromLocation.name}, SAP Doc: ${doc.sapDocNum}`,
        }],
      });
      await destLote.save();
      created.lotesCreated++;
    }

    // Update inventario for both locations
    // Source: only decrease available (total stays same)
    await Inventario.findOneAndUpdate(
      { productId: product._id, locationId: fromLocation._id },
      {
        $inc: { quantityAvailable: -item.quantity },
        $set: { lastMovementDate: new Date() },
      },
      { upsert: true }
    );
    // Destination: increase both total and available (new stock)
    await updateInventario(Inventario, product._id, toLocation._id, item.quantity);

    transferItems.push({
      productId: product._id,
      lotNumber: item.batchNumber,
      quantity: item.quantity,
      destLoteId: destLote._id,
    });
  }

  // Create Consignacion record
  // Filter to only items with loteId (required by schema)
  const itemsWithLote = transferItems.filter(i => i.destLoteId);

  if (itemsWithLote.length === 0) {
    // No batch-tracked items to record
    return {
      created,
      summary: `${created.lotesUpdated} lotes actualizados, ${created.lotesCreated} lotes creados (no consignación - sin lotes)`,
      importedAs: null,
    };
  }

  const consignacion = new Consignacion({
    fromLocationId: firstFromLocation?._id,
    toLocationId: firstToLocation?._id,
    items: itemsWithLote.map(i => ({
      productId: i.productId,
      loteId: i.destLoteId, // Reference to destination lote
      lotNumber: i.lotNumber,
      quantitySent: i.quantity,
      quantityReceived: i.quantity, // Already received for imported docs
    })),
    sapIntegration: {
      pushed: true,
      status: 'SYNCED',
      docEntry: doc.sapDocEntry,
      docNum: doc.sapDocNum,
      docType: 'StockTransfers',
      syncDate: new Date(),
      error: null,
      retryCount: 0,
      retrying: false,
    },
    status: 'RECIBIDO',
    confirmedAt: new Date(),
    notes: `Importado desde documento externo SAP ${doc.sapDocNum}`,
    createdBy: user,
  });
  await consignacion.save();
  created.consignacion = 1;

  return {
    created,
    summary: `${created.lotesUpdated} lotes actualizados, ${created.lotesCreated} lotes creados, ${created.consignacion} consignación`,
    importedAs: {
      documentType: 'Consignacion',
      documentId: consignacion._id,
    },
  };
}

/**
 * Import DeliveryNote (reduces Lotes, creates Consumo)
 */
async function importDeliveryNote(doc, { Producto, Locacion, Lote, Inventario, Consumo, user }) {
  const items = doc.items || [];
  const created = { lotesUpdated: 0, consumo: 0 };
  const consumoItems = [];
  let firstLocation = null;

  for (const item of items) {
    const product = await Producto.findOne({ sapItemCode: item.sapItemCode, active: true });
    const location = await findLocationByWarehouseOrBin(Locacion, item.warehouseCode, item.binAbsEntry);

    if (!firstLocation) firstLocation = location;

    if (!item.batchNumber) {
      // No batch tracking - just update inventory (consumption)
      await Inventario.findOneAndUpdate(
        { productId: product._id, locationId: location._id },
        {
          $inc: { quantityAvailable: -item.quantity, quantityConsumed: item.quantity },
          $set: { lastMovementDate: new Date(), lastConsumedDate: new Date() },
        },
        { upsert: true }
      );
      consumoItems.push({
        productId: product._id,
        sapItemCode: item.sapItemCode,
        productName: product.name,
        loteId: null,
        lotNumber: null,
        quantity: item.quantity,
      });
      continue;
    }

    const lote = await Lote.findOne({
      productId: product._id,
      lotNumber: item.batchNumber,
      currentLocationId: location._id,
    });

    // Consumption: decrease available, increase consumed (total stays same)
    lote.quantityAvailable -= item.quantity;
    lote.quantityConsumed = (lote.quantityConsumed || 0) + item.quantity;
    lote.historia.push({
      fecha: new Date(),
      user: user ? { _id: user._id, firstname: user.firstname, lastname: user.lastname } : null,
      accion: 'Consumo (SAP)',
      detalles: `Cantidad: -${item.quantity}, SAP Doc: ${doc.sapDocNum}`,
    });
    await lote.save();
    created.lotesUpdated++;

    // Update inventario (special handling for consumption)
    await Inventario.findOneAndUpdate(
      { productId: product._id, locationId: location._id },
      {
        $inc: { quantityAvailable: -item.quantity, quantityConsumed: item.quantity },
        $set: { lastMovementDate: new Date(), lastConsumedDate: new Date() },
      },
      { upsert: true }
    );

    consumoItems.push({
      productId: product._id,
      sapItemCode: item.sapItemCode,
      productName: product.name,
      loteId: lote._id,
      lotNumber: item.batchNumber,
      quantity: item.quantity,
    });
  }

  // Create Consumo record
  const consumo = new Consumo({
    centroId: firstLocation?._id,
    centroName: firstLocation?.name,
    sapCardCode: firstLocation?.sapIntegration?.cardCode,
    items: consumoItems.map(i => ({
      productId: i.productId,
      sapItemCode: i.sapItemCode,
      productName: i.productName,
      loteId: i.loteId,
      lotNumber: i.lotNumber || 'SIN-LOTE',
      quantity: i.quantity,
    })),
    sapIntegration: {
      pushed: true,
      docEntry: doc.sapDocEntry,
      docNum: doc.sapDocNum,
      docType: 'DeliveryNotes',
      syncDate: new Date(),
      error: null,
      retryCount: 0,
      retrying: false,
    },
    status: 'SYNCED',
    notes: `Importado desde documento externo SAP ${doc.sapDocNum}`,
    createdBy: user,
  });
  await consumo.save();
  created.consumo = 1;

  return {
    created,
    summary: `${created.lotesUpdated} lotes actualizados, ${created.consumo} consumo`,
    importedAs: {
      documentType: 'Consumo',
      documentId: consumo._id,
    },
  };
}

/**
 * Update inventario aggregation
 */
async function updateInventario(Inventario, productId, locationId, quantityChange) {
  await Inventario.findOneAndUpdate(
    { productId, locationId },
    {
      $inc: { quantityAvailable: quantityChange, quantityTotal: quantityChange },
      $set: { lastMovementDate: new Date() },
    },
    { upsert: true }
  );
}

module.exports = {
  validateImport,
  importDocument,
};
