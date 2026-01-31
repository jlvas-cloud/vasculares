/**
 * Nightly Reconciliation Job
 * Runs document reconciliation against SAP to detect external changes.
 *
 * Schedule: Every day at 2:00 AM (configurable via RECONCILIATION_CRON env var)
 *
 * Usage:
 *   // In server startup:
 *   require('./jobs/nightlyReconciliation').start();
 *
 * Or run manually:
 *   node jobs/nightlyReconciliation.js --run-now --company-id=<companyId>
 */
const cron = require('node-cron');
const reconciliationService = require('../services/reconciliationService');
const { getCompanyModel } = require('../getModel');

// Default schedule: 2:00 AM every day
const DEFAULT_CRON_SCHEDULE = '0 2 * * *';
const CRON_SCHEDULE = process.env.RECONCILIATION_CRON || DEFAULT_CRON_SCHEDULE;

let scheduledTask = null;

/**
 * Run reconciliation for all companies
 * If COMPANY_ID env var is set, only runs for that company (single-tenant mode)
 */
async function runForAllCompanies() {
  console.log('[NightlyReconciliation] Starting nightly reconciliation run...');

  try {
    let companies;

    // Single-tenant mode: only run for configured company
    if (process.env.COMPANY_ID) {
      console.log(`[NightlyReconciliation] Single-tenant mode: using COMPANY_ID ${process.env.COMPANY_ID}`);
      companies = [{ _id: process.env.COMPANY_ID }];
    } else {
      // Multi-tenant mode: get all active companies
      const Company = await getCompanyModel();
      companies = await Company.find({ isActive: { $ne: false } }).lean();
    }

    console.log(`[NightlyReconciliation] Found ${companies.length} active companies`);

    const results = [];

    for (const company of companies) {
      try {
        console.log(`[NightlyReconciliation] Running for company: ${company._id}`);

        const result = await reconciliationService.runReconciliation(company._id.toString(), {
          runType: 'NIGHTLY',
        });

        results.push({
          companyId: company._id,
          status: result.status,
          externalDocsFound: result.stats?.externalDocsFound || 0,
          errors: result.errors?.length || 0,
        });

        console.log(`[NightlyReconciliation] Company ${company._id}: ${result.status}, found ${result.stats?.externalDocsFound || 0} external docs`);

      } catch (companyError) {
        console.error(`[NightlyReconciliation] Error for company ${company._id}:`, companyError.message);
        results.push({
          companyId: company._id,
          status: 'ERROR',
          error: companyError.message,
        });
      }
    }

    console.log('[NightlyReconciliation] Completed nightly reconciliation run');
    return results;

  } catch (error) {
    console.error('[NightlyReconciliation] Fatal error:', error);
    throw error;
  }
}

/**
 * Run reconciliation for a specific company
 */
async function runForCompany(companyId) {
  console.log(`[NightlyReconciliation] Running for company: ${companyId}`);

  const result = await reconciliationService.runReconciliation(companyId, {
    runType: 'NIGHTLY',
  });

  console.log(`[NightlyReconciliation] Completed: ${result.status}`);
  console.log(`[NightlyReconciliation] Documents checked: ${result.stats?.totalDocumentsChecked || 0}`);
  console.log(`[NightlyReconciliation] External docs found: ${result.stats?.externalDocsFound || 0}`);

  if (result.errors?.length > 0) {
    console.log(`[NightlyReconciliation] Errors: ${result.errors.length}`);
    result.errors.forEach(err => console.log(`  - ${err.phase}: ${err.message}`));
  }

  return result;
}

/**
 * Start the scheduled job
 */
function start() {
  if (scheduledTask) {
    console.log('[NightlyReconciliation] Job already scheduled');
    return;
  }

  console.log(`[NightlyReconciliation] Scheduling job with cron: ${CRON_SCHEDULE}`);

  scheduledTask = cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await runForAllCompanies();
    } catch (error) {
      console.error('[NightlyReconciliation] Job failed:', error);
    }
  }, {
    timezone: process.env.TZ || 'America/Lima',
  });

  console.log('[NightlyReconciliation] Job scheduled successfully');
}

/**
 * Stop the scheduled job
 */
function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[NightlyReconciliation] Job stopped');
  }
}

/**
 * Check if job is running
 */
function isRunning() {
  return scheduledTask !== null;
}

// Export for programmatic use
module.exports = {
  start,
  stop,
  isRunning,
  runForAllCompanies,
  runForCompany,
};

// CLI mode: run immediately if --run-now flag is passed
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--run-now')) {
    const companyIdArg = args.find(a => a.startsWith('--company-id='));
    const companyId = companyIdArg ? companyIdArg.split('=')[1] : null;

    // Need to initialize MongoDB connection
    require('../connection');

    // Wait for connection
    setTimeout(async () => {
      try {
        if (companyId) {
          await runForCompany(companyId);
        } else {
          await runForAllCompanies();
        }
        console.log('[NightlyReconciliation] Manual run completed');
        process.exit(0);
      } catch (error) {
        console.error('[NightlyReconciliation] Manual run failed:', error);
        process.exit(1);
      }
    }, 2000);
  } else {
    console.log('Usage: node nightlyReconciliation.js --run-now [--company-id=<id>]');
    console.log('');
    console.log('Options:');
    console.log('  --run-now                Run reconciliation immediately');
    console.log('  --company-id=<id>        Run for specific company (default: all companies)');
    process.exit(0);
  }
}
