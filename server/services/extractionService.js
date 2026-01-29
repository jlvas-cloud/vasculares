/**
 * Extraction Service
 * Uses Google Gemini 2.5 for OCR extraction from packing lists and consumption documents
 * Falls back to Claude for non-OCR tasks if needed
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Extraction prompt for BIOTRONIK/Centralmed packing lists
const EXTRACTION_PROMPT = `Analyze these packing list images and extract all product items.

These are medical device packing lists (typically from BIOTRONIK for Orsiro Mission coronary stents).

For each product line item, extract:
- code: The article/product code (numeric, e.g., 419113)
- name: Full product name (e.g., "Orsiro Mission 2.25/15")
- lotNumber: The lot/batch number (e.g., "06253084")
- expiryDate: Expiry date in YYYY-MM-DD format (convert from UBD format like "09.07.2028" to "2028-07-09")
- quantity: Number of units (look for quantity column or "X PZS")

Important notes:
- The packing list may span multiple pages/images
- Each row typically represents one product with its lot number
- UBD (Use By Date) is the expiry date
- Article number is the product code
- Be thorough - extract ALL items from all images

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "items": [
    {
      "code": 419113,
      "name": "Orsiro Mission 2.25/15",
      "lotNumber": "06253084",
      "expiryDate": "2028-07-09",
      "quantity": 1
    }
  ],
  "documentInfo": {
    "documentNumber": "string or null",
    "date": "YYYY-MM-DD or null",
    "supplier": "string or null"
  },
  "warnings": []
}

If any field is unclear, make your best guess and add a warning message.`;

// Extraction prompt for consumption documents (stickers, handwritten, reports)
const CONSUMPTION_EXTRACTION_PROMPT = `You are extracting consumed medical product data from hospital consumption documents.

Each image is a consumption form ("Reporte Material a Consignación") from a hospital. Each form documents ONE consumed product.

## DATA SOURCE PRIORITY (STRICT)

1. **STICKER (highest priority):** Each form has a "STICKER" section (usually at the bottom). If a BIOTRONIK product sticker/label is attached there, ALL product information (code, name, lot number) MUST come from the sticker. The sticker is machine-printed and always accurate. Zoom into and carefully read every field on the sticker.

2. **Handwritten/printed fields (fallback):** Only use the handwritten fields (MATERIAL, LOTE, REFERENCIA) if NO sticker is present. Handwriting is error-prone — read each digit individually.

3. **Patient information:** Extract patient name, doctor name, and procedure date from the handwritten fields at the top of the form (PACIENTE, RESPONSABLE, FECHA). These are always handwritten regardless of sticker presence.

## STICKER READING GUIDE

BIOTRONIK stickers typically contain:
- Product name: "Orsiro Mission" followed by dimensions (e.g., "2.75/22")
- REF number: The 6-digit product code (e.g., 419113). ALWAYS starts with 3 or 4.
- LOT number: 8-digit batch number starting with 0 (e.g., 02252644)
- Barcode and other regulatory markings
- Look for labels: REF, LOT, SN on the sticker

Read the sticker character by character. If the sticker is small or partially unclear, still attempt to read it — machine print is more reliable than handwriting.

## HANDWRITTEN READING GUIDE (when no sticker)

- Product codes are ALWAYS 6 digits starting with 3 or 4. If you read a 6, it is likely a 4.
- Lot numbers are 8 digits starting with 0.
- Watch for common confusions: 3↔7, 1↔7, 4↔6, 2↔Z, 0↔O
- REFERENCIA field = product code
- LOTE field = lot number

## MULTIPLE ITEMS

A single image may contain MULTIPLE stickers. Each sticker = one separate consumed item. Extract ALL items from every image.

## OUTPUT FORMAT

For each consumed item extract:
- code: 6-digit product code (from sticker REF or handwritten REFERENCIA)
- name: Product name (from sticker or MATERIAL field)
- lotNumber: 8-digit lot number (from sticker LOT or handwritten LOTE). Set to null if illegible.
- quantity: Number consumed (default 1)
- patientName: Patient name (from PACIENTE field, null if not visible)
- doctorName: Doctor name (from RESPONSABLE field, null if not visible)
- procedureDate: Date in YYYY-MM-DD format (from FECHA field, DD/MM/YY format in Latin America, null if not visible)

Return ONLY valid JSON (no markdown, no explanation):
{
  "items": [
    {
      "code": "419113",
      "name": "Orsiro Mission 2.25/15",
      "lotNumber": "06253084",
      "quantity": 1,
      "patientName": null,
      "doctorName": null,
      "procedureDate": null
    }
  ],
  "warnings": []
}

Add a warning for any field you are uncertain about.`;

/**
 * Call Gemini API with files and a prompt
 * @param {Array<{buffer: Buffer, mimetype: string}>} files
 * @param {string} prompt
 * @returns {Promise<Object>} Parsed JSON response
 */
async function callGemini(files, prompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  // Build parts array
  const parts = [];

  for (const file of files) {
    const base64Data = file.buffer.toString('base64');
    parts.push({
      inlineData: {
        mimeType: file.mimetype,
        data: base64Data
      }
    });
  }

  // Add the text prompt
  parts.push({ text: prompt });

  // Call Gemini
  const result = await model.generateContent(parts);
  const response = await result.response;
  const responseText = response.text();

  // Parse JSON from response
  let extractedData;
  try {
    extractedData = JSON.parse(responseText);
  } catch (parseError) {
    // Try to extract JSON from response if it has markdown or extra text
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      extractedData = JSON.parse(jsonStr);
    } else {
      console.error('Raw response:', responseText);
      throw new Error('Failed to parse extraction response as JSON');
    }
  }

  return extractedData;
}

/**
 * Extract packing list data from images using Gemini
 * @param {Array<{buffer: Buffer, mimetype: string}>} files - Array of file objects
 * @returns {Promise<Object>} Extracted data with items array
 */
async function extractPackingList(files) {
  if (!files || files.length === 0) {
    throw new Error('No files provided for extraction');
  }

  try {
    const extractedData = await callGemini(files, EXTRACTION_PROMPT);

    // Validate the response structure
    if (!extractedData.items || !Array.isArray(extractedData.items)) {
      throw new Error('Invalid extraction response: missing items array');
    }

    // Add metadata
    extractedData.filesProcessed = files.length;
    extractedData.extractedAt = new Date().toISOString();

    return extractedData;

  } catch (error) {
    console.error('Gemini API extraction error:', error);
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

/**
 * Build the constraint section for the prompt with known products and lots
 * @param {Array<{code: string, name: string}>} knownProducts
 * @param {Array<{lotNumber: string, productCode: string, productName: string}>} knownLots
 * @returns {string}
 */
function buildConstraintSection(knownProducts, knownLots) {
  let section = '\n\n## KNOWN VALID DATA (use this to validate your reading)\n\n';

  if (knownProducts && knownProducts.length > 0) {
    section += '### Valid Product Codes\nThe ONLY valid product codes are:\n';
    for (const p of knownProducts) {
      section += `- ${p.code}: ${p.name}\n`;
    }
    section += '\nYour extracted code MUST match one of these exactly. If your OCR reading does not match any code, pick the closest match and add a warning.\n';
  }

  if (knownLots && knownLots.length > 0) {
    section += '\n### Lot Numbers Currently at This Location\nThese are the lot numbers available at this centro:\n';
    for (const l of knownLots) {
      section += `- ${l.lotNumber} (${l.productCode} - ${l.productName})\n`;
    }
    section += '\nIf your OCR reading is close to one of these lot numbers, use the known lot number. If it does not match any, still return what you read — it may be a lot not yet in the system.\n';
  }

  return section;
}

/**
 * Extract consumption data from documents using Gemini
 * @param {Array<{buffer: Buffer, mimetype: string}>} files - Array of file objects
 * @param {Object} [constraints] - Known products and lots to constrain extraction
 * @param {Array<{code: string, name: string}>} [constraints.products] - Known valid products
 * @param {Array<{lotNumber: string, productCode: string, productName: string}>} [constraints.lots] - Known lots at location
 * @returns {Promise<Object>} Extracted data with items array
 */
async function extractConsumptionDocument(files, constraints) {
  if (!files || files.length === 0) {
    throw new Error('No files provided for extraction');
  }

  try {
    let prompt = CONSUMPTION_EXTRACTION_PROMPT;

    // Append known product/lot constraints if available
    if (constraints) {
      prompt += buildConstraintSection(constraints.products, constraints.lots);
    }

    const extractedData = await callGemini(files, prompt);

    // Validate the response structure
    if (!extractedData.items || !Array.isArray(extractedData.items)) {
      throw new Error('Invalid extraction response: missing items array');
    }

    // Add metadata
    extractedData.filesProcessed = files.length;
    extractedData.extractedAt = new Date().toISOString();

    return extractedData;

  } catch (error) {
    console.error('Gemini API extraction error:', error);
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

module.exports = {
  extractPackingList,
  extractConsumptionDocument
};
