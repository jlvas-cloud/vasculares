/**
 * Reconciliation Controller
 * API endpoints for SAP document reconciliation
 */
const reconciliationService = require('../services/reconciliationService');

/**
 * POST /api/reconciliation/run
 * Trigger an on-demand reconciliation run
 *
 * Body params (all optional):
 * - fromDate: ISO date string - start of date range (overrides auto-calculation)
 * - toDate: ISO date string - end of date range (defaults to now)
 *
 * If no dates provided, uses moving window logic:
 * - From last successful run's completedAt, or goLiveDate if first run
 */
exports.triggerRun = async (req, res, next) => {
  try {
    const { fromDate, toDate } = req.body;

    // Check if a run is already in progress
    const inProgress = await reconciliationService.isRunInProgress(req.companyId);
    if (inProgress) {
      return res.status(409).json({
        error: 'Ya hay una reconciliación en progreso. Por favor espere a que termine.',
      });
    }

    // Run reconciliation
    const result = await reconciliationService.runReconciliation(req.companyId, {
      runType: 'ON_DEMAND',
      fromDate: fromDate ? new Date(fromDate) : null,
      toDate: toDate ? new Date(toDate) : null,
      triggeredBy: req.user,
    });

    res.json(result);
  } catch (error) {
    console.error('Error triggering reconciliation:', error);
    next(error);
  }
};

/**
 * GET /api/reconciliation/status
 * Get latest reconciliation run status and pending documents count
 */
exports.getStatus = async (req, res, next) => {
  try {
    const latestRun = await reconciliationService.getLatestRun(req.companyId);
    const pendingDocs = await reconciliationService.getPendingExternalDocuments(req.companyId, {
      status: 'PENDING_REVIEW',
      limit: 100, // Just to count
    });

    res.json({
      latestRun,
      pendingDocumentsCount: pendingDocs.length,
    });
  } catch (error) {
    console.error('Error getting reconciliation status:', error);
    next(error);
  }
};

/**
 * GET /api/reconciliation/runs
 * Get reconciliation run history
 */
exports.getRunHistory = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const runs = await reconciliationService.getRunHistory(req.companyId, parseInt(limit));
    res.json(runs);
  } catch (error) {
    console.error('Error getting run history:', error);
    next(error);
  }
};

/**
 * GET /api/reconciliation/external-documents
 * Get external SAP documents (filtered by status)
 */
exports.getExternalDocuments = async (req, res, next) => {
  try {
    const { status, limit = 50 } = req.query;
    const docs = await reconciliationService.getPendingExternalDocuments(req.companyId, {
      status: status || null, // null = all statuses
      limit: parseInt(limit),
    });
    res.json(docs);
  } catch (error) {
    console.error('Error getting external documents:', error);
    next(error);
  }
};

/**
 * PUT /api/reconciliation/external-documents/:id/status
 * Update external document status (acknowledge, ignore, etc.)
 */
exports.updateDocumentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['ACKNOWLEDGED', 'IMPORTED', 'IGNORED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Status inválido. Valores permitidos: ${validStatuses.join(', ')}`,
      });
    }

    const doc = await reconciliationService.updateExternalDocumentStatus(
      req.companyId,
      id,
      status,
      req.user,
      notes
    );

    if (!doc) {
      return res.status(404).json({ error: 'Documento externo no encontrado' });
    }

    res.json(doc);
  } catch (error) {
    console.error('Error updating document status:', error);
    next(error);
  }
};

/**
 * GET /api/reconciliation/config
 * Get reconciliation configuration (goLiveDate, etc.)
 */
exports.getConfig = async (req, res, next) => {
  try {
    const config = await reconciliationService.getReconciliationConfig(req.companyId);
    res.json(config);
  } catch (error) {
    console.error('Error getting reconciliation config:', error);
    next(error);
  }
};

/**
 * PUT /api/reconciliation/config/go-live-date
 * Manually set the goLiveDate (admin override)
 */
exports.setGoLiveDate = async (req, res, next) => {
  try {
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Fecha requerida' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }

    const result = await reconciliationService.setGoLiveDate(req.companyId, parsedDate, req.user);
    res.json(result);
  } catch (error) {
    console.error('Error setting goLiveDate:', error);
    next(error);
  }
};
