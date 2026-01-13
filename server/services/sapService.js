/**
 * SAP Business One Service Layer Integration
 * Handles authentication and stock transfer operations
 *
 * Security features:
 * - Login mutex prevents concurrent authentication race conditions
 * - OData filter sanitization prevents injection attacks
 * - Request timeouts prevent hung connections
 */
const https = require('https');

// Allow self-signed certificates for SAP server
// TODO: In production, use proper certificates with custom https.Agent
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
const SESSION_DURATION_MS = parseInt(process.env.SAP_SESSION_DURATION_MS) || 25 * 60 * 1000; // Default 25 min (SAP default is 30)

// Login mutex - prevents concurrent login race conditions
let loginPromise = null;

// Request timeout in milliseconds
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

// Debug mode - only log sensitive data when explicitly enabled
const DEBUG_SAP = process.env.DEBUG_SAP === 'true';

/**
 * Sanitize string for use in OData filter expressions
 * Prevents OData injection attacks
 *
 * @param {string} value - Value to sanitize
 * @param {string} fieldName - Field name for error messages
 * @returns {string} Sanitized value
 * @throws {Error} If value contains invalid characters
 */
function sanitizeODataValue(value, fieldName = 'value') {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  // Allow alphanumeric, dots, hyphens, underscores, spaces
  // This covers most SAP item codes, warehouse codes, batch numbers
  const sanitized = value.trim();

  if (!/^[a-zA-Z0-9.\-_ ]+$/.test(sanitized)) {
    throw new Error(`${fieldName} contains invalid characters: ${value}`);
  }

  // Escape single quotes for OData
  return sanitized.replace(/'/g, "''");
}

/**
 * Make an HTTP request to SAP B1 Service Layer with timeout
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
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  // Add timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal = controller.signal;

  try {
    const response = await fetch(url, options);

    // Handle session expiry
    if (response.status === 401 && includeSession) {
      console.log('SAP session expired, re-authenticating...');
      await login();
      headers['Cookie'] = `B1SESSION=${sessionId}`;

      // Create new abort controller for retry
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS);

      try {
        return await fetch(url, { ...options, headers, signal: retryController.signal });
      } finally {
        clearTimeout(retryTimeoutId);
      }
    }

    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`SAP request timeout after ${REQUEST_TIMEOUT_MS / 1000}s: ${method} ${endpoint}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Login to SAP B1 Service Layer
 * Uses mutex to prevent concurrent login race conditions
 */
async function login() {
  // If login is already in progress, wait for it
  if (loginPromise) {
    console.log('Login already in progress, waiting...');
    return loginPromise;
  }

  // Start new login and store the promise
  loginPromise = (async () => {
    try {
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

      if (!data.SessionId) {
        throw new Error('SAP Login response missing SessionId');
      }

      sessionId = data.SessionId;
      sessionExpiry = Date.now() + SESSION_DURATION_MS;

      console.log('SAP B1 login successful');
      return data;
    } catch (error) {
      // Clear session on login failure
      sessionId = null;
      sessionExpiry = null;
      throw error;
    } finally {
      // Clear the mutex after login completes (success or failure)
      loginPromise = null;
    }
  })();

  return loginPromise;
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
 * Uses mutex to prevent concurrent login race conditions
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

  if (DEBUG_SAP) {
    console.log('Creating SAP Stock Transfer:', JSON.stringify(transferPayload, null, 2));
  }

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

  // Sanitize inputs to prevent OData injection
  const safeItemCode = sanitizeODataValue(itemCode, 'itemCode');
  let filter = `ItemCode eq '${safeItemCode}'`;

  if (warehouseCode) {
    const safeWarehouseCode = sanitizeODataValue(warehouseCode, 'warehouseCode');
    filter += ` and WarehouseCode eq '${safeWarehouseCode}'`;
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

  // Sanitize input to prevent OData injection
  const safeItemCode = sanitizeODataValue(itemCode, 'itemCode');

  const response = await sapRequest(
    'GET',
    `/BatchNumberDetails?$filter=ItemCode eq '${safeItemCode}'`
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

/**
 * Search for customers (Business Partners) in SAP B1
 * Used to map Centros to SAP customers for DeliveryNotes
 *
 * @param {string} search Search term (searches CardCode and CardName)
 * @param {number} limit Max results (default 20, max 100)
 * @returns {Array} Matching customers
 */
async function getCustomers(search = '', limit = 20) {
  await ensureSession();

  // Enforce max limit
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 20), 100);

  let filter = "CardType eq 'cCustomer'";
  if (search) {
    // Sanitize search term - allow more characters for names but escape properly
    const searchTerm = search
      .trim()
      .replace(/'/g, "''")  // Escape single quotes
      .replace(/[<>{}[\]\\]/g, ''); // Remove potentially dangerous chars

    if (searchTerm.length > 0) {
      filter += ` and (contains(CardCode,'${searchTerm}') or contains(CardName,'${searchTerm}'))`;
    }
  }

  const response = await sapRequest(
    'GET',
    `/BusinessPartners?$filter=${encodeURIComponent(filter)}&$select=CardCode,CardName,Phone1,EmailAddress,Address&$top=${safeLimit}&$orderby=CardName`
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message?.value || response.statusText;
    throw new Error(`Failed to get customers: ${errorMessage}`);
  }

  const data = await response.json();
  return data.value || [];
}

/**
 * Create a Delivery Note (Entrega) in SAP B1
 * Used for recording consumption at Centros
 *
 * @param {Object} params Delivery parameters
 * @param {string} params.cardCode Customer code (Centro's SAP customer)
 * @param {string} params.warehouseCode Warehouse code (usually "10" for consignment)
 * @param {Array} params.items Items to deliver
 * @param {string} params.items[].itemCode SAP item code
 * @param {number} params.items[].quantity Quantity
 * @param {string} params.items[].batchNumber Batch/lot number
 * @param {number} params.items[].price Unit price (optional)
 * @param {string} params.items[].currency Currency code (optional, default USD)
 * @param {string} params.comments Comments (patient, doctor, procedure info)
 * @returns {Object} SAP document info { DocEntry, DocNum }
 */
async function createDeliveryNote({ cardCode, cardName, warehouseCode, binAbsEntry, items, comments, doctorName }) {
  await ensureSession();

  const documentLines = items.map((item, index) => {
    const line = {
      LineNum: index,
      ItemCode: item.itemCode,
      Quantity: item.quantity,
      WarehouseCode: warehouseCode,
    };

    // Add price if provided
    if (item.price) {
      line.Price = item.price;
      line.Currency = item.currency || 'USD';
    }

    // Add batch number if provided
    if (item.batchNumber) {
      line.BatchNumbers = [{
        BatchNumber: item.batchNumber,
        Quantity: item.quantity,
      }];
    }

    // Add bin allocation if warehouse uses bins
    if (binAbsEntry) {
      line.DocumentLinesBinAllocations = [{
        BinAbsEntry: binAbsEntry,
        Quantity: item.quantity,
        AllowNegativeQuantity: 'tNO',
        SerialAndBatchNumbersBaseLine: 0,
      }];
    }

    return line;
  });

  const deliveryPayload = {
    CardCode: cardCode,
    Comments: comments || 'Consumo registrado desde Vasculares',
    // Required UDFs for clinic identification
    U_CTS_CLIHOS: cardCode,
    U_CTS_CLIHOS_NAME: cardName || cardCode,
    // Specialist/doctor fields
    U_CTS_INST: 'n/a',
    U_CTS_INST_NAME: doctorName || null,
    DocumentLines: documentLines,
  };

  if (DEBUG_SAP) {
    console.log('Creating SAP Delivery Note:', JSON.stringify(deliveryPayload, null, 2));
  }

  const response = await sapRequest('POST', '/DeliveryNotes', deliveryPayload);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message?.value || response.statusText;
    throw new Error(`SAP Delivery Note failed: ${errorMessage}`);
  }

  const result = await response.json();
  console.log('SAP Delivery Note created:', result.DocNum);

  return {
    DocEntry: result.DocEntry,
    DocNum: result.DocNum,
  };
}

/**
 * Get SAP Service Layer base URL
 * Exposes only the URL, not credentials
 */
function getServiceUrl() {
  return SAP_CONFIG.serviceUrl;
}

module.exports = {
  login,
  logout,
  ensureSession,
  createStockTransfer,
  getItemInventory,
  getItemBatches,
  verifyConnection,
  getCustomers,
  createDeliveryNote,
  getServiceUrl,
};
