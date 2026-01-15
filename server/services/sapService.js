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

/**
 * Validate batch-item relationship against SAP
 * Checks if a batch number exists in SAP and returns its linked ItemCode
 *
 * @param {string} batchNumber - The batch/lot number to validate
 * @returns {Object} - { exists: boolean, sapItemCode: string|null, batchDetails: object|null }
 *
 * Usage:
 *   const result = await validateBatchItem('06251742');
 *   if (result.exists && result.sapItemCode !== expectedItemCode) {
 *     // Mismatch! Batch belongs to different product in SAP
 *   }
 */
async function validateBatchItem(batchNumber) {
  // WHY THIS EXISTS: When receiving new goods, we validate batch numbers against SAP
  // to catch data entry or OCR errors. If a batch already exists in SAP for a DIFFERENT
  // product, we block the receipt and alert the user. This prevents accidentally
  // assigning the same batch number to two different products.
  // Example: SAP has batch "233" for product 419183. User tries to receive batch "233"
  // for product 419165 (typo). Validation catches this mismatch.
  await ensureSession();

  try {
    const sanitizedBatch = sanitizeODataValue(batchNumber, 'batchNumber');
    const endpoint = `/BatchNumberDetails?$filter=Batch eq '${sanitizedBatch}'&$top=1`;

    const response = await sapRequest('GET', endpoint);

    if (!response.ok) {
      throw new Error(`SAP request failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.value || data.value.length === 0) {
      // Batch doesn't exist in SAP - this is OK for new batches
      return {
        exists: false,
        sapItemCode: null,
        batchDetails: null,
      };
    }

    const batchDetails = data.value[0];
    return {
      exists: true,
      sapItemCode: batchDetails.ItemCode,
      batchDetails: {
        itemCode: batchDetails.ItemCode,
        batch: batchDetails.Batch,
        quantity: batchDetails.Quantity,
        expiryDate: batchDetails.ExpDate,
      },
    };
  } catch (error) {
    console.error('Error validating batch in SAP:', error.message);
    // On error, return unknown state - let caller decide how to handle
    return {
      exists: null, // Unknown
      sapItemCode: null,
      batchDetails: null,
      error: error.message,
    };
  }
}

/**
 * Validate multiple batches against SAP
 * Efficient batch validation for goods receipt with multiple items
 *
 * @param {Array} items - Array of { batchNumber, expectedItemCode } objects
 * @returns {Object} - { valid: boolean, mismatches: Array, errors: Array }
 */
async function validateBatchItems(items) {
  const results = {
    valid: true,
    mismatches: [],
    errors: [],
    validated: [],
  };

  for (const item of items) {
    const validation = await validateBatchItem(item.batchNumber);

    if (validation.error) {
      results.errors.push({
        batchNumber: item.batchNumber,
        error: validation.error,
      });
      continue;
    }

    if (validation.exists && validation.sapItemCode !== item.expectedItemCode) {
      results.valid = false;
      results.mismatches.push({
        batchNumber: item.batchNumber,
        expectedItemCode: item.expectedItemCode,
        sapItemCode: validation.sapItemCode,
        message: `Batch ${item.batchNumber} belongs to item ${validation.sapItemCode} in SAP, not ${item.expectedItemCode}`,
      });
    } else {
      results.validated.push({
        batchNumber: item.batchNumber,
        expectedItemCode: item.expectedItemCode,
        sapItemCode: validation.sapItemCode,
        isNewBatch: !validation.exists,
      });
    }
  }

  return results;
}

/**
 * Execute a SQL query via SAP Service Layer SQLQueries endpoint
 * Creates the query if it doesn't exist, then executes it
 *
 * @param {string} queryCode - Unique identifier for the query
 * @param {string} queryName - Display name
 * @param {string} sqlText - SQL query text
 * @returns {Promise<Array>} Query results
 */
const createdQueries = new Set();

async function executeSQLQuery(queryCode, queryName, sqlText) {
  await ensureSession();
  const baseUrl = SAP_CONFIG.serviceUrl;

  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `B1SESSION=${sessionId}`,
  };

  // Create query if not already created this session
  if (!createdQueries.has(queryCode)) {
    try {
      const createResponse = await fetch(`${baseUrl}/SQLQueries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          SqlCode: queryCode,
          SqlName: queryName,
          SqlText: sqlText,
        }),
      });

      if (createResponse.ok) {
        createdQueries.add(queryCode);
      } else {
        // Query might already exist from previous session, that's OK
        createdQueries.add(queryCode);
      }
    } catch (err) {
      // Continue anyway - query might exist
      createdQueries.add(queryCode);
    }
  }

  // Execute the query with pagination
  const allResults = [];
  let url = `${baseUrl}/SQLQueries('${queryCode}')/List`;
  let pageCount = 0;
  const maxPages = 100;

  while (url && pageCount < maxPages) {
    const execResponse = await fetch(url, {
      method: 'POST',
      headers,
    });

    if (!execResponse.ok) {
      const error = await execResponse.json();
      throw new Error(`SQL query failed: ${error.error?.message?.value || 'Unknown error'}`);
    }

    const data = await execResponse.json();
    const results = data.value || [];
    allResults.push(...results);

    const nextLink = data['odata.nextLink'];
    if (nextLink) {
      url = nextLink.startsWith('http') ? nextLink : `${baseUrl}/${nextLink}`;
    } else {
      url = null;
    }
    pageCount++;
  }

  return allResults;
}

/**
 * Get ALL batch stock for an item at a specific location in SAP
 * Returns all batches with their quantities - more efficient than per-batch queries
 *
 * @param {string} itemCode - SAP item code
 * @param {string} warehouseCode - SAP warehouse code
 * @param {number|null} binAbsEntry - Bin absolute entry (for bin locations)
 * @returns {Promise<Object>} { success: boolean, batches: Array<{batchNumber, quantity}>, error?: string }
 */
async function getAllBatchStockAtLocation(itemCode, warehouseCode, binAbsEntry = null) {
  await ensureSession();

  try {
    const safeItemCode = sanitizeODataValue(itemCode, 'itemCode');
    const safeWarehouse = sanitizeODataValue(warehouseCode, 'warehouseCode');

    let sqlText;
    let queryCode;

    // Generate a safe query code (alphanumeric only)
    const safeQueryCode = (str) => str.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

    if (binAbsEntry) {
      // Location with bin - use OBBQ (one query per item+bin)
      queryCode = `VBIN_${safeQueryCode(safeItemCode)}_${binAbsEntry}`.substring(0, 50);
      sqlText = `
        SELECT T1.DistNumber AS BatchNum, T0.OnHandQty AS Quantity
        FROM OBBQ T0
        INNER JOIN OBTN T1 ON T0.SnBMDAbs = T1.AbsEntry
        WHERE T0.ItemCode = '${safeItemCode}'
          AND T0.BinAbs = ${binAbsEntry}
          AND T0.OnHandQty > 0
      `.trim();
    } else {
      // Location without bin - use OIBT (one query per item+warehouse)
      queryCode = `VWH_${safeQueryCode(safeItemCode)}_${safeQueryCode(safeWarehouse)}`.substring(0, 50);
      sqlText = `
        SELECT T0.BatchNum, T0.Quantity
        FROM OIBT T0
        WHERE T0.ItemCode = '${safeItemCode}'
          AND T0.WhsCode = '${safeWarehouse}'
          AND T0.Quantity > 0
      `.trim();
    }

    const results = await executeSQLQuery(queryCode, 'Item Batch Stock', sqlText);

    const batches = (results || []).map(row => ({
      batchNumber: row.BatchNum,
      quantity: row.Quantity || row.OnHandQty || 0,
    }));

    return {
      success: true,
      batches,
    };
  } catch (error) {
    console.error('Error getting batch stock from SAP:', error.message);
    return {
      success: false,
      batches: [],
      error: error.message,
    };
  }
}

/**
 * Verify batch stock at a specific location in SAP
 * Uses the more efficient getAllBatchStockAtLocation internally
 *
 * @param {string} itemCode - SAP item code
 * @param {string} batchNumber - Batch/lot number
 * @param {string} warehouseCode - SAP warehouse code
 * @param {number|null} binAbsEntry - Bin absolute entry (for bin locations)
 * @returns {Promise<Object>} { exists: boolean, quantity: number, error?: string }
 */
async function verifyBatchStockAtLocation(itemCode, batchNumber, warehouseCode, binAbsEntry = null) {
  const result = await getAllBatchStockAtLocation(itemCode, warehouseCode, binAbsEntry);

  if (!result.success) {
    return {
      exists: null,
      quantity: 0,
      error: result.error,
    };
  }

  const batch = result.batches.find(b => b.batchNumber === batchNumber);

  return {
    exists: batch ? batch.quantity > 0 : false,
    quantity: batch ? batch.quantity : 0,
  };
}

/**
 * Verify multiple batch items for a stock transfer
 * Pre-operation guard for consignments
 *
 * Optimized: Groups items by itemCode and queries once per item (not per batch)
 * This reduces SAP queries from N (per batch) to M (per unique item)
 *
 * @param {Array} items - Array of { itemCode, batchNumber, quantity }
 * @param {string} sourceWarehouse - SAP warehouse code
 * @param {number|null} sourceBinAbsEntry - Bin absolute entry (for bin locations)
 * @returns {Promise<Object>} { valid: boolean, mismatches: Array, errors: Array, verified: Array }
 */
async function verifyBatchStockForTransfer(items, sourceWarehouse, sourceBinAbsEntry = null) {
  const results = {
    valid: true,
    mismatches: [],
    errors: [],
    verified: [],
  };

  // Group items by itemCode to minimize SAP queries
  const itemsByCode = {};
  for (const item of items) {
    if (!itemsByCode[item.itemCode]) {
      itemsByCode[item.itemCode] = [];
    }
    itemsByCode[item.itemCode].push(item);
  }

  // Query SAP once per unique itemCode
  for (const [itemCode, itemList] of Object.entries(itemsByCode)) {
    const sapResult = await getAllBatchStockAtLocation(itemCode, sourceWarehouse, sourceBinAbsEntry);

    if (!sapResult.success) {
      // SAP error for this item = can't verify any of its batches
      results.valid = false;
      for (const item of itemList) {
        results.errors.push({
          itemCode: item.itemCode,
          batchNumber: item.batchNumber,
          error: sapResult.error,
        });
      }
      continue;
    }

    // Build a map of batch -> quantity for quick lookup
    const sapBatchMap = {};
    for (const batch of sapResult.batches) {
      sapBatchMap[batch.batchNumber] = batch.quantity;
    }

    // Check each batch in the item list
    for (const item of itemList) {
      const sapQuantity = sapBatchMap[item.batchNumber] || 0;

      if (sapQuantity < item.quantity) {
        results.valid = false;
        results.mismatches.push({
          itemCode: item.itemCode,
          batchNumber: item.batchNumber,
          requestedQuantity: item.quantity,
          sapQuantity: sapQuantity,
          message: sapQuantity === 0
            ? `Lote ${item.batchNumber} no tiene stock en SAP para este almacén`
            : `Lote ${item.batchNumber}: SAP muestra ${sapQuantity} unidades, pero intentas transferir ${item.quantity}`,
        });
      } else {
        results.verified.push({
          itemCode: item.itemCode,
          batchNumber: item.batchNumber,
          requestedQuantity: item.quantity,
          sapQuantity: sapQuantity,
        });
      }
    }
  }

  return results;
}

// ============================================
// DOCUMENT RECONCILIATION FUNCTIONS
// Query SAP for recent documents to detect external changes
// ============================================

/**
 * Format date for OData filter (SAP B1 format)
 * @param {Date} date
 * @returns {string} Formatted date string like '2026-01-13'
 */
function formatODataDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Fetch all pages from a SAP OData endpoint
 * Follows odata.nextLink for pagination
 *
 * @param {string} initialEndpoint - Initial endpoint URL
 * @returns {Promise<Array>} All records across all pages
 */
async function fetchAllPages(initialEndpoint) {
  const allResults = [];
  let url = `${SAP_CONFIG.serviceUrl}${initialEndpoint}`;
  let pageCount = 0;
  const maxPages = 100;

  while (url && pageCount < maxPages) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${sessionId}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message?.value || `Failed to fetch: ${response.status}`);
    }

    const data = await response.json();
    const results = data.value || [];
    allResults.push(...results);

    // Follow pagination link if present
    const nextLink = data['odata.nextLink'];
    if (nextLink) {
      url = nextLink.startsWith('http') ? nextLink : `${SAP_CONFIG.serviceUrl}/${nextLink}`;
    } else {
      url = null;
    }
    pageCount++;
  }

  return allResults;
}

/**
 * Get recent Purchase Delivery Notes from SAP using SQL query
 * Filters server-side for efficiency - only fetches documents with our item codes
 *
 * @param {Date} since - Get documents since this date
 * @param {Array<string>} itemCodes - Filter to documents containing these item codes (required for SQL)
 * @returns {Promise<Object>} { success: boolean, documents: Array, error?: string }
 */
async function getRecentPurchaseDeliveryNotes(since, itemCodes = null) {
  await ensureSession();

  try {
    // If no item codes provided, fall back to empty result (reconciliation always provides codes)
    if (!itemCodes || itemCodes.length === 0) {
      return { success: true, documents: [] };
    }

    const formattedDate = since.toISOString().split('T')[0]; // YYYY-MM-DD format for SQL
    const escapedCodes = itemCodes.map(code => `'${sanitizeODataValue(code)}'`).join(',');

    // SQL query that filters and joins on the server side
    // OPDN = Purchase Delivery Note header, PDN1 = lines, IBT1 = batch allocations
    const sqlText = `
      SELECT DISTINCT
        T0.DocEntry, T0.DocNum, T0.DocDate, T0.CardCode, T0.CardName, T0.Comments,
        T1.LineNum, T1.ItemCode, T1.Quantity, T1.WhsCode,
        T2.BatchNum as BatchNumber, T2.Quantity as BatchQty
      FROM OPDN T0
      INNER JOIN PDN1 T1 ON T0.DocEntry = T1.DocEntry
      LEFT JOIN IBT1 T2 ON T1.DocEntry = T2.BaseEntry AND T1.LineNum = T2.BaseLinNum AND T2.BaseType = 20
      WHERE T0.DocDate >= '${formattedDate}'
        AND T1.ItemCode IN (${escapedCodes})
      ORDER BY T0.DocDate DESC, T0.DocEntry, T1.LineNum
    `.trim();

    // Use a hash of the date for unique query code
    const queryCode = `RECON_PDN_${formattedDate.replace(/-/g, '')}`;

    const results = await executeSQLQuery(queryCode, 'Reconciliation Purchase Delivery Notes', sqlText);

    // Group results by DocEntry to reconstruct document structure
    const docsMap = new Map();
    for (const row of results || []) {
      const docEntry = row.DocEntry;
      if (!docsMap.has(docEntry)) {
        docsMap.set(docEntry, {
          sapDocEntry: row.DocEntry,
          sapDocNum: row.DocNum,
          sapDocType: 'PurchaseDeliveryNote',
          sapDocDate: new Date(row.DocDate),
          cardCode: row.CardCode,
          cardName: row.CardName,
          comments: row.Comments,
          items: [],
        });
      }
      // Add line item (avoid duplicates from batch join)
      const doc = docsMap.get(docEntry);
      const existingLine = doc.items.find(i => i.lineNum === row.LineNum);
      if (!existingLine) {
        doc.items.push({
          lineNum: row.LineNum,
          sapItemCode: row.ItemCode,
          quantity: row.Quantity,
          batchNumber: row.BatchNumber || null,
          warehouseCode: row.WhsCode,
          binAbsEntry: null, // Would need OBIN join for this
        });
      }
    }

    return { success: true, documents: Array.from(docsMap.values()) };
  } catch (error) {
    console.error('Error fetching PurchaseDeliveryNotes via SQL:', error.message);
    // Fall back to OData approach if SQL fails (e.g., table not in allowlist)
    return getRecentPurchaseDeliveryNotesOData(since, itemCodes);
  }
}

/**
 * Fallback OData-based query for Purchase Delivery Notes
 * Used if SQL query fails (e.g., tables not in b1s_sqltable.conf)
 */
async function getRecentPurchaseDeliveryNotesOData(since, itemCodes = null) {
  try {
    const formattedDate = formatODataDate(since);
    const endpoint = `/PurchaseDeliveryNotes?$filter=DocDate ge '${formattedDate}'&$select=DocEntry,DocNum,DocDate,CardCode,CardName,Comments,DocumentLines&$orderby=DocDate desc`;

    let documents = await fetchAllPages(endpoint);

    // Filter to documents containing our item codes if specified
    if (itemCodes && itemCodes.length > 0) {
      const itemCodeSet = new Set(itemCodes);
      documents = documents.filter(doc =>
        doc.DocumentLines?.some(line => itemCodeSet.has(line.ItemCode))
      );
    }

    // Map to a simpler structure
    const mapped = documents.map(doc => ({
      sapDocEntry: doc.DocEntry,
      sapDocNum: doc.DocNum,
      sapDocType: 'PurchaseDeliveryNote',
      sapDocDate: new Date(doc.DocDate),
      cardCode: doc.CardCode,
      cardName: doc.CardName,
      comments: doc.Comments,
      items: (doc.DocumentLines || []).map(line => ({
        sapItemCode: line.ItemCode,
        quantity: line.Quantity,
        batchNumber: line.BatchNumbers?.[0]?.BatchNumber || null,
        warehouseCode: line.WarehouseCode,
        binAbsEntry: line.DocumentLinesBinAllocations?.[0]?.BinAbsEntry || null,
      })),
    }));

    return { success: true, documents: mapped };
  } catch (error) {
    console.error('Error fetching PurchaseDeliveryNotes via OData:', error.message);
    return { success: false, documents: [], error: error.message };
  }
}

/**
 * Get recent Stock Transfers from SAP using SQL query
 * Filters server-side for efficiency - only fetches transfers with our item codes
 *
 * @param {Date} since - Get documents since this date
 * @param {Array<string>} itemCodes - Filter to documents containing these item codes (required for SQL)
 * @returns {Promise<Object>} { success: boolean, documents: Array, error?: string }
 */
async function getRecentStockTransfers(since, itemCodes = null) {
  await ensureSession();

  try {
    // If no item codes provided, fall back to empty result
    if (!itemCodes || itemCodes.length === 0) {
      return { success: true, documents: [] };
    }

    const formattedDate = since.toISOString().split('T')[0];
    const escapedCodes = itemCodes.map(code => `'${sanitizeODataValue(code)}'`).join(',');

    // SQL query: OWTR = Stock Transfer header, WTR1 = lines, IBT1 = batch allocations, WTQ1 = bin allocations
    // WTQ1 contains bin allocations: BinAbsFrom (source bin), BinAbsTo (destination bin)
    const sqlText = `
      SELECT DISTINCT
        T0.DocEntry, T0.DocNum, T0.DocDate, T0.Comments, T0.CardCode, T0.CardName,
        T1.LineNum, T1.ItemCode, T1.Quantity, T1.FromWhsCod as FromWarehouse, T1.WhsCode as ToWarehouse,
        T2.BatchNum as BatchNumber, T2.Quantity as BatchQty,
        T3.BnAbsEntry as FromBinAbsEntry, T4.BnAbsEntry as ToBinAbsEntry
      FROM OWTR T0
      INNER JOIN WTR1 T1 ON T0.DocEntry = T1.DocEntry
      LEFT JOIN IBT1 T2 ON T1.DocEntry = T2.BaseEntry AND T1.LineNum = T2.BaseLinNum AND T2.BaseType = 67
      LEFT JOIN WTQ1 T3 ON T1.DocEntry = T3.DocEntry AND T1.LineNum = T3.LineNum AND T3.BinActTyp = 1
      LEFT JOIN WTQ1 T4 ON T1.DocEntry = T4.DocEntry AND T1.LineNum = T4.LineNum AND T4.BinActTyp = 2
      WHERE T0.DocDate >= '${formattedDate}'
        AND T1.ItemCode IN (${escapedCodes})
      ORDER BY T0.DocDate DESC, T0.DocEntry, T1.LineNum
    `.trim();

    const queryCode = `RECON_WTR_${formattedDate.replace(/-/g, '')}`;

    const results = await executeSQLQuery(queryCode, 'Reconciliation Stock Transfers', sqlText);

    // Group results by DocEntry to reconstruct document structure
    const docsMap = new Map();
    for (const row of results || []) {
      const docEntry = row.DocEntry;
      if (!docsMap.has(docEntry)) {
        docsMap.set(docEntry, {
          sapDocEntry: row.DocEntry,
          sapDocNum: row.DocNum,
          sapDocType: 'StockTransfer',
          sapDocDate: new Date(row.DocDate),
          sapCardCode: row.CardCode,
          sapCardName: row.CardName,
          comments: row.Comments,
          items: [],
        });
      }
      // Add line item (avoid duplicates from batch join)
      const doc = docsMap.get(docEntry);
      const existingLine = doc.items.find(i => i.lineNum === row.LineNum);
      if (!existingLine) {
        doc.items.push({
          lineNum: row.LineNum,
          sapItemCode: row.ItemCode,
          quantity: row.Quantity,
          batchNumber: row.BatchNumber || null,
          fromWarehouseCode: row.FromWarehouse,
          toWarehouseCode: row.ToWarehouse,
          fromBinAbsEntry: row.FromBinAbsEntry || null,
          toBinAbsEntry: row.ToBinAbsEntry || null,
        });
      }
    }

    return { success: true, documents: Array.from(docsMap.values()) };
  } catch (error) {
    console.error('Error fetching StockTransfers via SQL:', error.message);
    // Fall back to OData approach if SQL fails
    return getRecentStockTransfersOData(since, itemCodes);
  }
}

/**
 * Fallback OData-based query for Stock Transfers
 * Used if SQL query fails (e.g., tables not in b1s_sqltable.conf)
 */
async function getRecentStockTransfersOData(since, itemCodes = null) {
  try {
    const formattedDate = formatODataDate(since);
    // NOTE: $select strips nested bin allocations, but that's OK for list queries.
    // Full bin data is fetched individually during import via getStockTransferByDocEntry()
    const endpoint = `/StockTransfers?$filter=DocDate ge '${formattedDate}'&$select=DocEntry,DocNum,DocDate,CardCode,CardName,Comments,StockTransferLines&$orderby=DocDate desc`;

    let documents = await fetchAllPages(endpoint);

    // Filter to documents containing our item codes if specified
    if (itemCodes && itemCodes.length > 0) {
      const itemCodeSet = new Set(itemCodes);
      documents = documents.filter(doc =>
        doc.StockTransferLines?.some(line => itemCodeSet.has(line.ItemCode))
      );
    }

    // Map to a simpler structure
    const mapped = documents.map(doc => ({
      sapDocEntry: doc.DocEntry,
      sapDocNum: doc.DocNum,
      sapDocType: 'StockTransfer',
      sapDocDate: new Date(doc.DocDate),
      sapCardCode: doc.CardCode,
      sapCardName: doc.CardName,
      comments: doc.Comments,
      items: (doc.StockTransferLines || []).map(line => ({
        sapItemCode: line.ItemCode,
        quantity: line.Quantity,
        batchNumber: line.BatchNumbers?.[0]?.BatchNumber || null,
        fromWarehouseCode: line.FromWarehouseCode,
        toWarehouseCode: line.WarehouseCode,
        fromBinAbsEntry: line.StockTransferLinesBinAllocations?.find(a => a.BinActionType === 'batFromWarehouse')?.BinAbsEntry || null,
        toBinAbsEntry: line.StockTransferLinesBinAllocations?.find(a => a.BinActionType === 'batToWarehouse')?.BinAbsEntry || null,
      })),
    }));

    return { success: true, documents: mapped };
  } catch (error) {
    console.error('Error fetching StockTransfers via OData:', error.message);
    return { success: false, documents: [], error: error.message };
  }
}

/**
 * Get a single StockTransfer by DocEntry with full bin allocation data
 * Used during import to get precise bin locations (list queries don't return bin allocations)
 *
 * @param {number} docEntry - SAP document entry number
 * @returns {Promise<Object>} { success: boolean, document: Object, error?: string }
 */
async function getStockTransferByDocEntry(docEntry) {
  await ensureSession();

  try {
    // Fetch single document by key - this returns full nested data including bin allocations
    const response = await sapRequest('GET', `/StockTransfers(${docEntry})`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message?.value || response.statusText;
      return { success: false, document: null, error: errorMessage };
    }

    const data = await response.json();

    // Map to our standard structure with bin allocations
    const mapped = {
      sapDocEntry: data.DocEntry,
      sapDocNum: data.DocNum,
      sapDocType: 'StockTransfer',
      sapDocDate: new Date(data.DocDate),
      sapCardCode: data.CardCode,
      sapCardName: data.CardName,
      comments: data.Comments,
      items: (data.StockTransferLines || []).map(line => ({
        lineNum: line.LineNum,
        sapItemCode: line.ItemCode,
        quantity: line.Quantity,
        batchNumber: line.BatchNumbers?.[0]?.BatchNumber || null,
        fromWarehouseCode: line.FromWarehouseCode,
        toWarehouseCode: line.WarehouseCode,
        fromBinAbsEntry: line.StockTransferLinesBinAllocations?.find(a => a.BinActionType === 'batFromWarehouse')?.BinAbsEntry || null,
        toBinAbsEntry: line.StockTransferLinesBinAllocations?.find(a => a.BinActionType === 'batToWarehouse')?.BinAbsEntry || null,
      })),
    };

    return { success: true, document: mapped };
  } catch (error) {
    console.error(`Error fetching StockTransfer ${docEntry}:`, error.message);
    return { success: false, document: null, error: error.message };
  }
}

/**
 * Get recent Delivery Notes from SAP using SQL query
 * Filters server-side for efficiency - only fetches deliveries with our item codes
 *
 * @param {Date} since - Get documents since this date
 * @param {Array<string>} itemCodes - Filter to documents containing these item codes (required for SQL)
 * @returns {Promise<Object>} { success: boolean, documents: Array, error?: string }
 */
async function getRecentDeliveryNotes(since, itemCodes = null) {
  await ensureSession();

  try {
    // If no item codes provided, fall back to empty result
    if (!itemCodes || itemCodes.length === 0) {
      return { success: true, documents: [] };
    }

    const formattedDate = since.toISOString().split('T')[0];
    const escapedCodes = itemCodes.map(code => `'${sanitizeODataValue(code)}'`).join(',');

    // SQL query: ODLN = Delivery Note header, DLN1 = lines, IBT1 = batch allocations
    const sqlText = `
      SELECT DISTINCT
        T0.DocEntry, T0.DocNum, T0.DocDate, T0.CardCode, T0.CardName, T0.Comments,
        T1.LineNum, T1.ItemCode, T1.Quantity, T1.WhsCode,
        T2.BatchNum as BatchNumber, T2.Quantity as BatchQty
      FROM ODLN T0
      INNER JOIN DLN1 T1 ON T0.DocEntry = T1.DocEntry
      LEFT JOIN IBT1 T2 ON T1.DocEntry = T2.BaseEntry AND T1.LineNum = T2.BaseLinNum AND T2.BaseType = 15
      WHERE T0.DocDate >= '${formattedDate}'
        AND T1.ItemCode IN (${escapedCodes})
      ORDER BY T0.DocDate DESC, T0.DocEntry, T1.LineNum
    `.trim();

    const queryCode = `RECON_DLN_${formattedDate.replace(/-/g, '')}`;

    const results = await executeSQLQuery(queryCode, 'Reconciliation Delivery Notes', sqlText);

    // Group results by DocEntry to reconstruct document structure
    const docsMap = new Map();
    for (const row of results || []) {
      const docEntry = row.DocEntry;
      if (!docsMap.has(docEntry)) {
        docsMap.set(docEntry, {
          sapDocEntry: row.DocEntry,
          sapDocNum: row.DocNum,
          sapDocType: 'DeliveryNote',
          sapDocDate: new Date(row.DocDate),
          cardCode: row.CardCode,
          cardName: row.CardName,
          comments: row.Comments,
          items: [],
        });
      }
      // Add line item (avoid duplicates from batch join)
      const doc = docsMap.get(docEntry);
      const existingLine = doc.items.find(i => i.lineNum === row.LineNum);
      if (!existingLine) {
        doc.items.push({
          lineNum: row.LineNum,
          sapItemCode: row.ItemCode,
          quantity: row.Quantity,
          batchNumber: row.BatchNumber || null,
          warehouseCode: row.WhsCode,
          binAbsEntry: null, // Would need OBIN join for this
        });
      }
    }

    return { success: true, documents: Array.from(docsMap.values()) };
  } catch (error) {
    console.error('Error fetching DeliveryNotes via SQL:', error.message);
    // Fall back to OData approach if SQL fails
    return getRecentDeliveryNotesOData(since, itemCodes);
  }
}

/**
 * Fallback OData-based query for Delivery Notes
 * Used if SQL query fails (e.g., tables not in b1s_sqltable.conf)
 */
async function getRecentDeliveryNotesOData(since, itemCodes = null) {
  try {
    const formattedDate = formatODataDate(since);
    const endpoint = `/DeliveryNotes?$filter=DocDate ge '${formattedDate}'&$select=DocEntry,DocNum,DocDate,CardCode,CardName,Comments,DocumentLines&$orderby=DocDate desc`;

    let documents = await fetchAllPages(endpoint);

    // Filter to documents containing our item codes if specified
    if (itemCodes && itemCodes.length > 0) {
      const itemCodeSet = new Set(itemCodes);
      documents = documents.filter(doc =>
        doc.DocumentLines?.some(line => itemCodeSet.has(line.ItemCode))
      );
    }

    // Map to a simpler structure
    const mapped = documents.map(doc => ({
      sapDocEntry: doc.DocEntry,
      sapDocNum: doc.DocNum,
      sapDocType: 'DeliveryNote',
      sapDocDate: new Date(doc.DocDate),
      cardCode: doc.CardCode,
      cardName: doc.CardName,
      comments: doc.Comments,
      items: (doc.DocumentLines || []).map(line => ({
        sapItemCode: line.ItemCode,
        quantity: line.Quantity,
        batchNumber: line.BatchNumbers?.[0]?.BatchNumber || null,
        warehouseCode: line.WarehouseCode,
        binAbsEntry: line.DocumentLinesBinAllocations?.[0]?.BinAbsEntry || null,
      })),
    }));

    return { success: true, documents: mapped };
  } catch (error) {
    console.error('Error fetching DeliveryNotes via OData:', error.message);
    return { success: false, documents: [], error: error.message };
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
  getCustomers,
  createDeliveryNote,
  getServiceUrl,
  validateBatchItem,
  validateBatchItems,
  // Pre-operation guards
  getAllBatchStockAtLocation,
  verifyBatchStockAtLocation,
  verifyBatchStockForTransfer,
  executeSQLQuery,
  // Document reconciliation
  getRecentPurchaseDeliveryNotes,
  getRecentStockTransfers,
  getRecentDeliveryNotes,
  // Single document fetch (for import with full bin data)
  getStockTransferByDocEntry,
};
