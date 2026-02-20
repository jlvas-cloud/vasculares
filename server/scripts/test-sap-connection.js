/**
 * SAP Connection & Table Access Diagnostic Script
 * Tests: Login, OData endpoints, SQLQueries access to key tables
 *
 * Usage: node scripts/test-sap-connection.js
 */

require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const SAP_CONFIG = {
  serviceUrl: process.env.SAP_B1_SERVICE_URL,
  companyDB: process.env.SAP_B1_COMPANY_DB,
  username: process.env.SAP_B1_USERNAME,
  password: process.env.SAP_B1_PASSWORD,
};

let sessionId = null;

const PASS = '\x1b[32m✓ PASS\x1b[0m';
const FAIL = '\x1b[31m✗ FAIL\x1b[0m';
const WARN = '\x1b[33m⚠ WARN\x1b[0m';

async function sapFetch(method, endpoint, body = null) {
  const url = `${SAP_CONFIG.serviceUrl}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Cookie'] = `B1SESSION=${sessionId}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  options.signal = controller.signal;

  try {
    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ─── Test 1: Login ───
async function testLogin() {
  console.log('\n── Test 1: SAP Login ──');
  console.log(`  URL: ${SAP_CONFIG.serviceUrl}`);
  console.log(`  DB:  ${SAP_CONFIG.companyDB}`);
  console.log(`  User: ${SAP_CONFIG.username}`);

  try {
    const res = await sapFetch('POST', '/Login', {
      CompanyDB: SAP_CONFIG.companyDB,
      UserName: SAP_CONFIG.username,
      Password: SAP_CONFIG.password,
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`  ${FAIL} Login failed: ${res.status} - ${text}`);
      return false;
    }

    const data = await res.json();
    if (!data.SessionId) {
      console.log(`  ${FAIL} No SessionId in response`);
      return false;
    }

    sessionId = data.SessionId;
    console.log(`  ${PASS} Login successful (session: ${sessionId.substring(0, 8)}...)`);
    return true;
  } catch (err) {
    console.log(`  ${FAIL} Connection error: ${err.message}`);
    return false;
  }
}

// ─── Test 2: OData Endpoints ───
async function testODataEndpoint(name, endpoint) {
  try {
    const res = await sapFetch('GET', endpoint);
    if (!res.ok) {
      const text = await res.text();
      console.log(`  ${FAIL} ${name}: ${res.status} - ${text.substring(0, 100)}`);
      return false;
    }
    const data = await res.json();
    const count = data.value ? data.value.length : 'N/A';
    console.log(`  ${PASS} ${name} (${count} records)`);
    return true;
  } catch (err) {
    console.log(`  ${FAIL} ${name}: ${err.message}`);
    return false;
  }
}

async function testODataEndpoints() {
  console.log('\n── Test 2: OData Endpoints ──');

  const tests = [
    ['Items (top 3)', "/Items?$top=3&$select=ItemCode,ItemName"],
    ['Warehouses', "/Warehouses?$select=WarehouseCode,WarehouseName"],
    ['BatchNumberDetails (top 3)', "/BatchNumberDetails?$top=3&$select=Batch,ItemCode"],
    ['BusinessPartners (top 3)', "/BusinessPartners?$top=3&$select=CardCode,CardName"],
    ['StockTransfers (top 1)', "/StockTransfers?$top=1&$select=DocEntry,DocNum"],
    ['PurchaseDeliveryNotes (top 1)', "/PurchaseDeliveryNotes?$top=1&$select=DocEntry,DocNum"],
    ['DeliveryNotes (top 1)', "/DeliveryNotes?$top=1&$select=DocEntry,DocNum"],
  ];

  let passed = 0;
  for (const [name, endpoint] of tests) {
    const ok = await testODataEndpoint(name, endpoint);
    if (ok) passed++;
  }
  console.log(`  Result: ${passed}/${tests.length} passed`);
  return passed === tests.length;
}

// ─── Test 3: SQLQueries access to tables ───
async function testSQLTable(tableName, description, sql) {
  const queryCode = `TEST_${tableName}`;
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `B1SESSION=${sessionId}`,
  };
  const baseUrl = SAP_CONFIG.serviceUrl;

  try {
    // Delete existing query (ignore errors)
    await fetch(`${baseUrl}/SQLQueries('${queryCode}')`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});

    // Create the query
    const createRes = await fetch(`${baseUrl}/SQLQueries`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        SqlCode: queryCode,
        SqlName: `Test ${tableName} access`,
        SqlText: sql,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      const msg = err.error?.message?.value || `HTTP ${createRes.status}`;
      console.log(`  ${FAIL} ${tableName} (${description}): Create query failed - ${msg}`);
      return false;
    }

    // Execute the query
    const execRes = await fetch(`${baseUrl}/SQLQueries('${queryCode}')/List`, {
      method: 'POST',
      headers,
    });

    if (!execRes.ok) {
      const err = await execRes.json().catch(() => ({}));
      const msg = err.error?.message?.value || `HTTP ${execRes.status}`;
      // Check if it's an AllowList issue
      if (msg.includes('AllowList') || msg.includes('allow') || msg.includes('denied')) {
        console.log(`  ${FAIL} ${tableName} (${description}): NOT in AllowList - ${msg}`);
      } else {
        console.log(`  ${FAIL} ${tableName} (${description}): ${msg}`);
      }
      return false;
    }

    const data = await execRes.json();
    const count = data.value ? data.value.length : 0;
    console.log(`  ${PASS} ${tableName} (${description}) - ${count} rows returned`);

    // Cleanup
    await fetch(`${baseUrl}/SQLQueries('${queryCode}')`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});

    return true;
  } catch (err) {
    console.log(`  ${FAIL} ${tableName} (${description}): ${err.message}`);
    return false;
  }
}

async function testSQLQueries() {
  console.log('\n── Test 3: SQLQueries Table Access (AllowList) ──');

  // Queries matching actual app code (sapService.js + sapSyncService.js)
  const tables = [
    // sapSyncService.js - inventory sync
    ['OIBT', 'Batch inventory by warehouse (sync)', "SELECT TOP 3 T0.ItemCode, T0.BatchNum, T0.WhsCode, T0.Quantity FROM OIBT T0 WHERE T0.Quantity > 0"],
    ['OBBQ+OBTN', 'Batch qty by bin (sync)', "SELECT TOP 3 T0.ItemCode, T1.DistNumber AS BatchNum, T0.WhsCode, T0.BinAbs, T0.OnHandQty AS Quantity FROM OBBQ T0 INNER JOIN OBTN T1 ON T0.SnBMDAbs = T1.AbsEntry WHERE T0.OnHandQty > 0"],
    ['OBTN', 'Batch master data', "SELECT TOP 3 T0.ItemCode, T0.DistNumber, T0.ExpDate FROM OBTN T0"],
    ['OBIN', 'Bin location codes', "SELECT TOP 3 T0.AbsEntry, T0.BinCode, T0.WhsCode FROM OBIN T0"],

    // sapService.js - pre-operation guard (getAllBatchStockAtLocation)
    ['OBBQ_guard', 'Pre-op guard bin query', "SELECT TOP 3 T1.DistNumber AS BatchNum, T0.OnHandQty AS Quantity FROM OBBQ T0 INNER JOIN OBTN T1 ON T0.SnBMDAbs = T1.AbsEntry WHERE T0.OnHandQty > 0"],

    // sapService.js - reconciliation: PurchaseDeliveryNotes (OPDN+PDN1+IBT1)
    ['OPDN+PDN1+IBT1', 'Reconciliation: Goods Receipts', "SELECT TOP 3 T0.DocEntry, T0.DocNum, T0.DocDate, T1.ItemCode, T1.Quantity, T2.BatchNum as BatchNumber FROM OPDN T0 INNER JOIN PDN1 T1 ON T0.DocEntry = T1.DocEntry LEFT JOIN IBT1 T2 ON T1.DocEntry = T2.BaseEntry AND T1.LineNum = T2.BaseLinNum AND T2.BaseType = 20 ORDER BY T0.DocDate DESC"],

    // sapService.js - reconciliation: StockTransfers (OWTR+WTR1+IBT1+WTQ1)
    ['OWTR+WTR1+IBT1', 'Reconciliation: Stock Transfers', "SELECT TOP 3 T0.DocEntry, T0.DocNum, T0.DocDate, T1.ItemCode, T1.Quantity, T1.FromWhsCod as FromWarehouse, T1.WhsCode as ToWarehouse, T2.BatchNum as BatchNumber, T3.BnAbsEntry as FromBinAbsEntry, T4.BnAbsEntry as ToBinAbsEntry FROM OWTR T0 INNER JOIN WTR1 T1 ON T0.DocEntry = T1.DocEntry LEFT JOIN IBT1 T2 ON T1.DocEntry = T2.BaseEntry AND T1.LineNum = T2.BaseLinNum AND T2.BaseType = 67 LEFT JOIN WTQ1 T3 ON T1.DocEntry = T3.DocEntry AND T1.LineNum = T3.LineNum AND T3.BinActTyp = 1 LEFT JOIN WTQ1 T4 ON T1.DocEntry = T4.DocEntry AND T1.LineNum = T4.LineNum AND T4.BinActTyp = 2 ORDER BY T0.DocDate DESC"],

    // sapService.js - reconciliation: DeliveryNotes (ODLN+DLN1+IBT1)
    ['ODLN+DLN1+IBT1', 'Reconciliation: Delivery Notes', "SELECT TOP 3 T0.DocEntry, T0.DocNum, T0.DocDate, T1.ItemCode, T1.Quantity, T2.BatchNum as BatchNumber FROM ODLN T0 INNER JOIN DLN1 T1 ON T0.DocEntry = T1.DocEntry LEFT JOIN IBT1 T2 ON T1.DocEntry = T2.BaseEntry AND T1.LineNum = T2.BaseLinNum AND T2.BaseType = 15 ORDER BY T0.DocDate DESC"],
  ];

  let passed = 0;
  for (const [table, desc, sql] of tables) {
    const ok = await testSQLTable(table, desc, sql);
    if (ok) passed++;
  }
  console.log(`  Result: ${passed}/${tables.length} tables accessible`);
  return passed === tables.length;
}

// ─── Test 4: Quick data sanity check ───
async function testDataSanity() {
  console.log('\n── Test 4: Data Sanity Check ──');

  // Check our products exist in SAP
  try {
    const res = await sapFetch('GET', "/Items?$filter=startswith(ItemCode,'419') or startswith(ItemCode,'364') or startswith(ItemCode,'391') or startswith(ItemCode,'369') or startswith(ItemCode,'381')&$select=ItemCode,ItemName&$top=5");
    if (res.ok) {
      const data = await res.json();
      const count = data.value ? data.value.length : 0;
      if (count > 0) {
        console.log(`  ${PASS} Found ${count}+ of our products in SAP (e.g., ${data.value[0].ItemCode})`);
      } else {
        console.log(`  ${WARN} No matching products found (419xxx, 364xxx, etc.)`);
      }
    }
  } catch (err) {
    console.log(`  ${FAIL} Product check: ${err.message}`);
  }

  // Check warehouse 01 and 10 exist
  try {
    const res = await sapFetch('GET', "/Warehouses?$filter=WarehouseCode eq '01' or WarehouseCode eq '10'&$select=WarehouseCode,WarehouseName");
    if (res.ok) {
      const data = await res.json();
      const codes = (data.value || []).map(w => w.WarehouseCode);
      if (codes.includes('01') && codes.includes('10')) {
        console.log(`  ${PASS} Warehouses 01 and 10 exist`);
      } else {
        console.log(`  ${WARN} Expected warehouses 01 and 10, found: ${codes.join(', ')}`);
      }
    }
  } catch (err) {
    console.log(`  ${FAIL} Warehouse check: ${err.message}`);
  }

  // Check bin locations in warehouse 10
  try {
    const res = await sapFetch('GET', "/BinLocations?$filter=Warehouse eq '10'&$select=AbsEntry,BinCode,Warehouse");
    if (res.ok) {
      const data = await res.json();
      const bins = (data.value || []).map(b => b.BinCode);
      console.log(`  ${PASS} Bin locations in WH 10: ${bins.join(', ') || 'none'}`);
    }
  } catch (err) {
    console.log(`  ${FAIL} Bin check: ${err.message}`);
  }
}

// ─── Main ───
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  SAP Connection Diagnostic           ║');
  console.log('╚══════════════════════════════════════╝');

  // Test 1: Login
  const loginOk = await testLogin();
  if (!loginOk) {
    console.log('\n\x1b[31mCannot proceed without login. Check SAP_B1_* env vars.\x1b[0m');
    process.exit(1);
  }

  // Test 2: OData endpoints
  await testODataEndpoints();

  // Test 3: SQLQueries table access
  await testSQLQueries();

  // Test 4: Data sanity
  await testDataSanity();

  console.log('\n── Done ──\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
