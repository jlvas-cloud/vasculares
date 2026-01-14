/**
 * Reconciliation Service
 * Detects SAP documents that involve our products but weren't created by our app.
 *
 * Flow:
 * 1. Get list of our tracked item codes (products with sapItemCode)
 * 2. Query SAP for recent documents (configurable lookback)
 * 3. Filter to documents containing our items
 * 4. Check each against our local database
 * 5. If we don't have a matching record, create an ExternalSapDocument
 *
 * Used by:
 * - Nightly cron job (automatic)
 * - On-demand API endpoint (admin-triggered)
 */
const {
  getProductosModel,
  getGoodsReceiptsModel,
  getConsignacionesModel,
  getConsumosModel,
  getExternalSapDocumentsModel,
  getReconciliationRunsModel,
  getVascularesConfigModel,
} = require('../getModel');
const sapService = require('./sapService');

/**
 * Calculate the date window for reconciliation using moving window logic.
 *
 * Priority:
 * 1. If fromDate is provided, use it (custom on-demand range)
 * 2. If last successful run exists, use its completedAt
 * 3. Fall back to goLiveDate from VascularesConfig
 *
 * @param {string} companyId
 * @param {Object} options
 * @returns {Promise<{since: Date, until: Date, dateSource: string}>}
 */
async function calculateDateWindow(companyId, options = {}) {
  const { fromDate, toDate, ReconciliationRuns } = options;

  // End date defaults to now
  const until = toDate ? new Date(toDate) : new Date();

  // If custom fromDate is provided, use it
  if (fromDate) {
    return {
      since: new Date(fromDate),
      until,
      dateSource: 'CUSTOM_RANGE',
    };
  }

  // Try to get last successful run's completedAt
  const lastSuccessfulRun = await ReconciliationRuns.findOne({
    companyId,
    status: 'COMPLETED',
  }).sort({ completedAt: -1 }).lean();

  if (lastSuccessfulRun?.completedAt) {
    return {
      since: lastSuccessfulRun.completedAt,
      until,
      dateSource: 'LAST_RUN',
    };
  }

  // Fall back to goLiveDate
  const VascularesConfig = await getVascularesConfigModel(companyId);
  const config = await VascularesConfig.findOne({ companyId }).lean();

  if (config?.reconciliation?.goLiveDate) {
    return {
      since: config.reconciliation.goLiveDate,
      until,
      dateSource: 'GO_LIVE_DATE',
    };
  }

  // No valid start date found
  return {
    since: null,
    until,
    dateSource: 'NONE',
  };
}

/**
 * Run document reconciliation
 *
 * Moving Date Window Logic:
 * - First run: from goLiveDate (set during initial sync) to now
 * - Subsequent nightly runs: from last successful run's completedAt to now
 * - On-demand with fromDate/toDate: use specified range
 * - On-demand without dates: same as nightly (from last run)
 *
 * @param {string} companyId - Company ID for database access
 * @param {Object} options - Configuration options
 * @param {string} options.runType - 'NIGHTLY' or 'ON_DEMAND'
 * @param {Date} options.fromDate - Custom start date (optional, overrides auto-calculation)
 * @param {Date} options.toDate - Custom end date (optional, defaults to now)
 * @param {Object} options.triggeredBy - User who triggered (for ON_DEMAND)
 * @param {Array<string>} options.documentTypes - Which types to check (default: all)
 * @returns {Promise<Object>} Run result with stats and errors
 */
async function runReconciliation(companyId, options = {}) {
  const {
    runType = 'ON_DEMAND',
    fromDate = null,
    toDate = null,
    triggeredBy = null,
    documentTypes = ['PurchaseDeliveryNote', 'StockTransfer', 'DeliveryNote'],
  } = options;

  const ReconciliationRuns = await getReconciliationRunsModel(companyId);
  const ExternalSapDocuments = await getExternalSapDocumentsModel(companyId);

  // Create run record (config will be updated after date calculation)
  const run = new ReconciliationRuns({
    runType,
    startedAt: new Date(),
    status: 'RUNNING',
    config: {
      documentTypes,
    },
    stats: {
      purchaseDeliveryNotesChecked: 0,
      stockTransfersChecked: 0,
      deliveryNotesChecked: 0,
      totalDocumentsChecked: 0,
      externalDocsFound: 0,
      externalPurchaseDeliveryNotes: 0,
      externalStockTransfers: 0,
      externalDeliveryNotes: 0,
    },
    errors: [],
    triggeredBy: triggeredBy ? {
      _id: triggeredBy._id,
      firstname: triggeredBy.firstname,
      lastname: triggeredBy.lastname,
      email: triggeredBy.email,
    } : null,
    companyId,
  });
  await run.save();

  try {
    // Get our tracked item codes
    const Productos = await getProductosModel(companyId);
    const products = await Productos.find({ sapItemCode: { $exists: true, $ne: null } }).lean();
    const ourItemCodes = products.map(p => p.sapItemCode);

    if (ourItemCodes.length === 0) {
      run.status = 'COMPLETED';
      run.completedAt = new Date();
      run.errors.push({
        phase: 'SETUP',
        message: 'No products with sapItemCode found - nothing to reconcile',
      });
      await run.save();
      return formatRunResult(run);
    }

    // Calculate date window using moving window logic
    const { since, until, dateSource } = await calculateDateWindow(companyId, {
      fromDate,
      toDate,
      ReconciliationRuns,
    });

    // Update run config with actual dates used
    run.config.fromDate = since;
    run.config.toDate = until;
    run.config.dateSource = dateSource;
    await run.save();

    // Check if we have a valid goLiveDate
    if (!since) {
      run.status = 'COMPLETED';
      run.completedAt = new Date();
      run.errors.push({
        phase: 'SETUP',
        message: 'No goLiveDate set. Run sync-inventory-from-sap.js first to set the reconciliation start date.',
      });
      await run.save();
      return formatRunResult(run);
    }

    // Get product lookup map for enriching items
    const productMap = {};
    for (const p of products) {
      productMap[p.sapItemCode] = {
        _id: p._id,
        name: p.name,
      };
    }

    // Process each document type
    if (documentTypes.includes('PurchaseDeliveryNote')) {
      await processPurchaseDeliveryNotes(companyId, run, since, ourItemCodes, productMap, ExternalSapDocuments);
    }

    if (documentTypes.includes('StockTransfer')) {
      await processStockTransfers(companyId, run, since, ourItemCodes, productMap, ExternalSapDocuments);
    }

    if (documentTypes.includes('DeliveryNote')) {
      await processDeliveryNotes(companyId, run, since, ourItemCodes, productMap, ExternalSapDocuments);
    }

    // Calculate totals
    run.stats.totalDocumentsChecked =
      run.stats.purchaseDeliveryNotesChecked +
      run.stats.stockTransfersChecked +
      run.stats.deliveryNotesChecked;

    run.stats.externalDocsFound =
      run.stats.externalPurchaseDeliveryNotes +
      run.stats.externalStockTransfers +
      run.stats.externalDeliveryNotes;

    run.status = 'COMPLETED';
    run.completedAt = new Date();
    await run.save();

    return formatRunResult(run);

  } catch (error) {
    console.error('Reconciliation run failed:', error);
    run.status = 'FAILED';
    run.completedAt = new Date();
    run.errors.push({
      phase: 'GENERAL',
      message: error.message,
      details: error.stack,
    });
    await run.save();
    return formatRunResult(run);
  }
}

/**
 * Process PurchaseDeliveryNotes (Goods Receipts)
 */
async function processPurchaseDeliveryNotes(companyId, run, since, ourItemCodes, productMap, ExternalSapDocuments) {
  try {
    const result = await sapService.getRecentPurchaseDeliveryNotes(since, ourItemCodes);

    if (!result.success) {
      run.errors.push({
        phase: 'PurchaseDeliveryNotes',
        message: result.error,
      });
      return;
    }

    run.stats.purchaseDeliveryNotesChecked = result.documents.length;

    // Get local GoodsReceipts to compare
    const GoodsReceipts = await getGoodsReceiptsModel(companyId);
    const localDocs = await GoodsReceipts.find({
      'sapIntegration.docEntry': { $exists: true },
    }).lean();
    const localDocEntries = new Set(localDocs.map(d => d.sapIntegration.docEntry));

    // Check each SAP document
    for (const sapDoc of result.documents) {
      // Skip if we created this document
      if (localDocEntries.has(sapDoc.sapDocEntry)) {
        continue;
      }

      // Skip if already tracked as external
      const existing = await ExternalSapDocuments.findOne({
        sapDocEntry: sapDoc.sapDocEntry,
        sapDocType: 'PurchaseDeliveryNote',
        companyId,
      });
      if (existing) {
        continue;
      }

      // Filter items to only our products
      const ourItems = sapDoc.items.filter(item => ourItemCodes.includes(item.sapItemCode));
      if (ourItems.length === 0) {
        continue;
      }

      // Enrich items with product info
      const enrichedItems = ourItems.map(item => ({
        ...item,
        productId: productMap[item.sapItemCode]?._id || null,
        productName: productMap[item.sapItemCode]?.name || null,
      }));

      // Create external document record
      const externalDoc = new ExternalSapDocuments({
        sapDocEntry: sapDoc.sapDocEntry,
        sapDocNum: sapDoc.sapDocNum,
        sapDocType: 'PurchaseDeliveryNote',
        sapDocDate: sapDoc.sapDocDate,
        items: enrichedItems,
        detectedAt: new Date(),
        detectedBy: run.runType === 'NIGHTLY' ? 'NIGHTLY_JOB' : 'ON_DEMAND',
        reconciliationRunId: run._id,
        status: 'PENDING_REVIEW',
        companyId,
      });
      await externalDoc.save();
      run.stats.externalPurchaseDeliveryNotes++;
    }
  } catch (error) {
    run.errors.push({
      phase: 'PurchaseDeliveryNotes',
      message: error.message,
    });
  }
}

/**
 * Process StockTransfers (Consignments)
 */
async function processStockTransfers(companyId, run, since, ourItemCodes, productMap, ExternalSapDocuments) {
  try {
    const result = await sapService.getRecentStockTransfers(since, ourItemCodes);

    if (!result.success) {
      run.errors.push({
        phase: 'StockTransfers',
        message: result.error,
      });
      return;
    }

    run.stats.stockTransfersChecked = result.documents.length;

    // Get local Consignaciones to compare
    const Consignaciones = await getConsignacionesModel(companyId);
    const localDocs = await Consignaciones.find({
      'sapIntegration.docEntry': { $exists: true },
    }).lean();
    const localDocEntries = new Set(localDocs.map(d => d.sapIntegration.docEntry));

    // Check each SAP document
    for (const sapDoc of result.documents) {
      // Skip if we created this document
      if (localDocEntries.has(sapDoc.sapDocEntry)) {
        continue;
      }

      // Skip if already tracked as external
      const existing = await ExternalSapDocuments.findOne({
        sapDocEntry: sapDoc.sapDocEntry,
        sapDocType: 'StockTransfer',
        companyId,
      });
      if (existing) {
        continue;
      }

      // Filter items to only our products
      const ourItems = sapDoc.items.filter(item => ourItemCodes.includes(item.sapItemCode));
      if (ourItems.length === 0) {
        continue;
      }

      // Enrich items with product info
      const enrichedItems = ourItems.map(item => ({
        ...item,
        productId: productMap[item.sapItemCode]?._id || null,
        productName: productMap[item.sapItemCode]?.name || null,
      }));

      // Create external document record
      const externalDoc = new ExternalSapDocuments({
        sapDocEntry: sapDoc.sapDocEntry,
        sapDocNum: sapDoc.sapDocNum,
        sapDocType: 'StockTransfer',
        sapDocDate: sapDoc.sapDocDate,
        items: enrichedItems,
        detectedAt: new Date(),
        detectedBy: run.runType === 'NIGHTLY' ? 'NIGHTLY_JOB' : 'ON_DEMAND',
        reconciliationRunId: run._id,
        status: 'PENDING_REVIEW',
        companyId,
      });
      await externalDoc.save();
      run.stats.externalStockTransfers++;
    }
  } catch (error) {
    run.errors.push({
      phase: 'StockTransfers',
      message: error.message,
    });
  }
}

/**
 * Process DeliveryNotes (Consumptions)
 */
async function processDeliveryNotes(companyId, run, since, ourItemCodes, productMap, ExternalSapDocuments) {
  try {
    const result = await sapService.getRecentDeliveryNotes(since, ourItemCodes);

    if (!result.success) {
      run.errors.push({
        phase: 'DeliveryNotes',
        message: result.error,
      });
      return;
    }

    run.stats.deliveryNotesChecked = result.documents.length;

    // Get local Consumos to compare
    const Consumos = await getConsumosModel(companyId);
    const localDocs = await Consumos.find({
      'sapIntegration.docEntry': { $exists: true },
    }).lean();
    const localDocEntries = new Set(localDocs.map(d => d.sapIntegration.docEntry));

    // Check each SAP document
    for (const sapDoc of result.documents) {
      // Skip if we created this document
      if (localDocEntries.has(sapDoc.sapDocEntry)) {
        continue;
      }

      // Skip if already tracked as external
      const existing = await ExternalSapDocuments.findOne({
        sapDocEntry: sapDoc.sapDocEntry,
        sapDocType: 'DeliveryNote',
        companyId,
      });
      if (existing) {
        continue;
      }

      // Filter items to only our products
      const ourItems = sapDoc.items.filter(item => ourItemCodes.includes(item.sapItemCode));
      if (ourItems.length === 0) {
        continue;
      }

      // Enrich items with product info
      const enrichedItems = ourItems.map(item => ({
        ...item,
        productId: productMap[item.sapItemCode]?._id || null,
        productName: productMap[item.sapItemCode]?.name || null,
      }));

      // Create external document record
      const externalDoc = new ExternalSapDocuments({
        sapDocEntry: sapDoc.sapDocEntry,
        sapDocNum: sapDoc.sapDocNum,
        sapDocType: 'DeliveryNote',
        sapDocDate: sapDoc.sapDocDate,
        items: enrichedItems,
        detectedAt: new Date(),
        detectedBy: run.runType === 'NIGHTLY' ? 'NIGHTLY_JOB' : 'ON_DEMAND',
        reconciliationRunId: run._id,
        status: 'PENDING_REVIEW',
        companyId,
      });
      await externalDoc.save();
      run.stats.externalDeliveryNotes++;
    }
  } catch (error) {
    run.errors.push({
      phase: 'DeliveryNotes',
      message: error.message,
    });
  }
}

/**
 * Format run result for API response
 */
function formatRunResult(run) {
  return {
    runId: run._id,
    runType: run.runType,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.completedAt ? run.completedAt - run.startedAt : null,
    config: run.config,
    stats: run.stats,
    errors: run.errors,
  };
}

/**
 * Get the latest reconciliation run for a company
 */
async function getLatestRun(companyId) {
  const ReconciliationRuns = await getReconciliationRunsModel(companyId);
  const run = await ReconciliationRuns.findOne({ companyId })
    .sort({ startedAt: -1 })
    .lean();
  return run ? formatRunResult(run) : null;
}

/**
 * Get reconciliation run history
 */
async function getRunHistory(companyId, limit = 10) {
  const ReconciliationRuns = await getReconciliationRunsModel(companyId);
  const runs = await ReconciliationRuns.find({ companyId })
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();
  return runs.map(formatRunResult);
}

/**
 * Get pending external documents for review
 */
async function getPendingExternalDocuments(companyId, options = {}) {
  const { status = 'PENDING_REVIEW', limit = 50 } = options;
  const ExternalSapDocuments = await getExternalSapDocumentsModel(companyId);

  const query = { companyId };
  if (status) {
    query.status = status;
  }

  const docs = await ExternalSapDocuments.find(query)
    .sort({ sapDocDate: -1 })
    .limit(limit)
    .lean();

  return docs;
}

/**
 * Update external document status (acknowledge, ignore, etc.)
 */
async function updateExternalDocumentStatus(companyId, docId, status, user, notes = null) {
  const ExternalSapDocuments = await getExternalSapDocumentsModel(companyId);

  const update = {
    status,
    reviewedAt: new Date(),
    reviewedBy: user ? {
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
    } : null,
  };

  if (notes) {
    update.notes = notes;
  }

  const doc = await ExternalSapDocuments.findByIdAndUpdate(docId, update, { new: true });
  return doc;
}

/**
 * Check if there's already a run in progress
 * Considers runs older than 1 hour as stale (server may have crashed)
 */
async function isRunInProgress(companyId) {
  const ReconciliationRuns = await getReconciliationRunsModel(companyId);

  // Consider runs older than 1 hour as stale
  const staleThreshold = new Date(Date.now() - 60 * 60 * 1000);

  const runningCount = await ReconciliationRuns.countDocuments({
    companyId,
    status: 'RUNNING',
    startedAt: { $gt: staleThreshold },
  });

  // Mark stale runs as failed
  await ReconciliationRuns.updateMany(
    {
      companyId,
      status: 'RUNNING',
      startedAt: { $lte: staleThreshold },
    },
    {
      $set: {
        status: 'FAILED',
        completedAt: new Date(),
      },
      $push: {
        errors: {
          timestamp: new Date(),
          phase: 'SYSTEM',
          message: 'Run marked as failed due to timeout (server may have restarted)',
        },
      },
    }
  );

  return runningCount > 0;
}

/**
 * Get reconciliation configuration for a company
 * Returns goLiveDate and other settings for the dashboard
 */
async function getReconciliationConfig(companyId) {
  const VascularesConfig = await getVascularesConfigModel(companyId);
  const config = await VascularesConfig.findOne({ companyId }).lean();

  if (!config?.reconciliation) {
    return {
      goLiveDate: null,
      goLiveDateSetBy: null,
      isConfigured: false,
    };
  }

  return {
    goLiveDate: config.reconciliation.goLiveDate,
    goLiveDateSetBy: config.reconciliation.goLiveDateSetBy,
    isConfigured: !!config.reconciliation.goLiveDate,
  };
}

/**
 * Manually set the goLiveDate (for admin override)
 */
async function setGoLiveDate(companyId, date, user) {
  const VascularesConfig = await getVascularesConfigModel(companyId);

  const config = await VascularesConfig.findOneAndUpdate(
    { companyId },
    {
      $set: {
        'reconciliation.goLiveDate': new Date(date),
        'reconciliation.goLiveDateSetBy': {
          type: 'MANUAL',
          user: user ? {
            _id: user._id,
            firstname: user.firstname,
            lastname: user.lastname,
          } : null,
          setAt: new Date(),
        },
      },
    },
    { upsert: true, new: true }
  );

  return {
    goLiveDate: config.reconciliation.goLiveDate,
    goLiveDateSetBy: config.reconciliation.goLiveDateSetBy,
  };
}

module.exports = {
  runReconciliation,
  getLatestRun,
  getRunHistory,
  getPendingExternalDocuments,
  updateExternalDocumentStatus,
  isRunInProgress,
  getReconciliationConfig,
  setGoLiveDate,
};
