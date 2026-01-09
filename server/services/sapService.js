/**
 * SAP Business One Service Layer Integration
 * Handles authentication and stock transfer operations
 */
const https = require('https');

// SAP B1 Service Layer configuration
const SAP_CONFIG = {
  serviceUrl: process.env.SAP_B1_SERVICE_URL || 'https://94.74.64.47:50000/b1s/v1',
  companyDB: process.env.SAP_B1_COMPANY_DB || 'SBO_VASCULARES',
  username: process.env.SAP_B1_USERNAME || 'manager',
  password: process.env.SAP_B1_PASSWORD || '',
};

// Session management
let sessionId = null;
let sessionExpiry = null;
const SESSION_DURATION_MS = 25 * 60 * 1000; // 25 minutes (SAP default is 30)

// Create HTTPS agent that allows self-signed certificates
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Make an HTTP request to SAP B1 Service Layer
 */
async function sapRequest(method, endpoint, body = null, includeSession = true) {
  const url = `${SAP_CONFIG.serviceUrl}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (includeSession && sessionId) {
    headers['Cookie'] = `B1SESSION=${sessionId}`;
  }

  const options = {
    method,
    headers,
    agent: httpsAgent,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  // Handle session expiry
  if (response.status === 401 && includeSession) {
    console.log('SAP session expired, re-authenticating...');
    await login();
    headers['Cookie'] = `B1SESSION=${sessionId}`;
    return fetch(url, { ...options, headers });
  }

  return response;
}

/**
 * Login to SAP B1 Service Layer
 */
async function login() {
  console.log('Logging in to SAP B1 Service Layer...');

  const response = await sapRequest('POST', '/Login', {
    CompanyDB: SAP_CONFIG.companyDB,
    UserName: SAP_CONFIG.username,
    Password: SAP_CONFIG.password,
  }, false);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SAP Login failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  sessionId = data.SessionId;
  sessionExpiry = Date.now() + SESSION_DURATION_MS;

  console.log('SAP B1 login successful');
  return data;
}

/**
 * Logout from SAP B1 Service Layer
 */
async function logout() {
  if (!sessionId) return;

  try {
    await sapRequest('POST', '/Logout', null, true);
    console.log('SAP B1 logout successful');
  } catch (error) {
    console.error('SAP B1 logout error:', error.message);
  } finally {
    sessionId = null;
    sessionExpiry = null;
  }
}

/**
 * Ensure we have a valid session
 */
async function ensureSession() {
  if (!sessionId || !sessionExpiry || Date.now() > sessionExpiry) {
    await login();
  }
  return sessionId;
}

/**
 * Create a Stock Transfer in SAP B1
 *
 * @param {Object} params Transfer parameters
 * @param {string} params.fromWarehouse Source warehouse code
 * @param {string} params.toWarehouse Destination warehouse code
 * @param {number} params.toBinAbsEntry Destination bin AbsEntry (for centros)
 * @param {Array} params.items Items to transfer
 * @param {string} params.items[].itemCode SAP item code
 * @param {number} params.items[].quantity Quantity to transfer
 * @param {string} params.items[].batchNumber Batch/lot number
 * @param {string} params.comments Optional comments
 * @returns {Object} SAP document info { DocEntry, DocNum }
 */
async function createStockTransfer({ fromWarehouse, toWarehouse, toBinAbsEntry, items, comments }) {
  await ensureSession();

  // Build stock transfer lines with batch numbers
  const stockTransferLines = items.map((item, index) => {
    const line = {
      LineNum: index,
      ItemCode: item.itemCode,
      Quantity: item.quantity,
      FromWarehouseCode: fromWarehouse,
      WarehouseCode: toWarehouse,
      BatchNumbers: [{
        BatchNumber: item.batchNumber,
        Quantity: item.quantity,
      }],
    };

    // Add bin allocation for destination (centros use bin locations)
    if (toBinAbsEntry) {
      line.StockTransferLinesBinAllocations = [{
        BinAbsEntry: toBinAbsEntry,
        Quantity: item.quantity,
        AllowNegativeQuantity: 'tNO',
        SerialAndBatchNumbersBaseLine: 0,
        BinActionType: 'batToWarehouse',
      }];
    }

    return line;
  });

  const transferPayload = {
    FromWarehouse: fromWarehouse,
    ToWarehouse: toWarehouse,
    Comments: comments || 'Transfer from Vasculares system',
    StockTransferLines: stockTransferLines,
  };

  console.log('Creating SAP Stock Transfer:', JSON.stringify(transferPayload, null, 2));

  const response = await sapRequest('POST', '/StockTransfers', transferPayload);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message?.value || response.statusText;
    throw new Error(`SAP Stock Transfer failed: ${errorMessage}`);
  }

  const result = await response.json();
  console.log('SAP Stock Transfer created:', result.DocNum);

  return {
    DocEntry: result.DocEntry,
    DocNum: result.DocNum,
  };
}

/**
 * Get item inventory by warehouse
 *
 * @param {string} itemCode SAP item code
 * @param {string} warehouseCode Warehouse code (optional)
 * @returns {Array} Inventory records
 */
async function getItemInventory(itemCode, warehouseCode = null) {
  await ensureSession();

  let filter = `ItemCode eq '${itemCode}'`;
  if (warehouseCode) {
    filter += ` and WarehouseCode eq '${warehouseCode}'`;
  }

  const response = await sapRequest(
    'GET',
    `/ItemWarehouseInfoCollection?$filter=${encodeURIComponent(filter)}`
  );

  if (!response.ok) {
    throw new Error(`Failed to get inventory: ${response.statusText}`);
  }

  const data = await response.json();
  return data.value || [];
}

/**
 * Get batch numbers for an item
 *
 * @param {string} itemCode SAP item code
 * @returns {Array} Batch number records
 */
async function getItemBatches(itemCode) {
  await ensureSession();

  const response = await sapRequest(
    'GET',
    `/BatchNumberDetails?$filter=ItemCode eq '${itemCode}'`
  );

  if (!response.ok) {
    throw new Error(`Failed to get batches: ${response.statusText}`);
  }

  const data = await response.json();
  return data.value || [];
}

/**
 * Verify connection to SAP B1 Service Layer
 */
async function verifyConnection() {
  try {
    await login();
    console.log('SAP B1 connection verified');
    return { success: true, message: 'Connected to SAP B1 Service Layer' };
  } catch (error) {
    console.error('SAP B1 connection failed:', error.message);
    return { success: false, message: error.message };
  }
}

module.exports = {
  login,
  logout,
  ensureSession,
  createStockTransfer,
  getItemInventory,
  getItemBatches,
  verifyConnection,
  SAP_CONFIG,
};
