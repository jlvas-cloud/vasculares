/**
 * Extraction Service
 * Uses Claude Vision API to extract data from packing list images and PDFs
 */
const Anthropic = require('@anthropic-ai/sdk');

// Initialize Anthropic client (uses ANTHROPIC_API_KEY from env)
const anthropic = new Anthropic();

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
const CONSUMPTION_EXTRACTION_PROMPT = `Analyze these consumption documents and extract all consumed medical products.

The documents may be:
- Product stickers/labels from packaging (often BIOTRONIK stickers with barcodes)
- Handwritten consumption forms ("Reporte Material a Consignación" or similar)
- Typed consumption reports
- Any combination of formats

Each file/page represents ONE consumed item. Extract one item per document/page.

For each consumed item, extract what you can see:
- code: Product/article code (number, typically 6 digits starting with 3 or 4, e.g., 419113). Look for fields labeled "Referencia", "REF", "Article", or "Código".
- name: Product name or description
- lotNumber: Lot/batch number. This is CRITICAL - read it very carefully character by character. Lot numbers are typically 8 digits (e.g., "02252644"). Look for fields labeled "Lote", "LOT", "Batch", or "SN". On BIOTRONIK stickers, the lot number appears after "LOT" or near the barcode. On handwritten forms, look for the "LOTE" field.
- quantity: Number consumed (default to 1 if not specified)
- patientName: Patient name (if visible, look for "Paciente" field)
- doctorName: Doctor name (if visible, look for "Doctor" or "Responsable" field)
- procedureDate: Date in YYYY-MM-DD format (if visible, look for "Fecha" field. Dates are typically in DD/MM/YY format in Latin America)

CRITICAL RULES:
- If a BIOTRONIK product sticker is present, it is the SOURCE OF TRUTH. Use the product code, lot number, and all data from the sticker over any handwritten fields. The sticker is machine-printed and always accurate.
- For lot numbers: read each digit individually and carefully - handwritten digits are often ambiguous
- Lot numbers for BIOTRONIK products are typically 8 digits starting with 0
- If you are unsure about any digit, add a warning
- NEVER guess or fabricate a lot number - if illegible, set to null and add a warning

IMPORTANT:
- Extract ALL items you can identify
- If lot number is not visible or illegible, set lotNumber to null and add a warning
- If quantity is unclear, set to 1
- Be thorough - look at ALL images/pages

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
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

If any field is unclear, add a warning message.`;

/**
 * Extract packing list data from images using Claude Vision
 * @param {Array<{buffer: Buffer, mimetype: string}>} files - Array of file objects
 * @returns {Promise<Object>} Extracted data with items array
 */
async function extractPackingList(files) {
  if (!files || files.length === 0) {
    throw new Error('No files provided for extraction');
  }

  // Build content array with all images
  const content = [];

  for (const file of files) {
    // Convert buffer to base64
    const base64Data = file.buffer.toString('base64');

    // Handle PDFs as document type, images as image type
    let mediaType = file.mimetype;
    if (mediaType === 'application/pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Data
        }
      });
    } else {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data
        }
      });
    }
  }

  if (content.length === 0) {
    throw new Error('No valid files to process.');
  }

  // Add the extraction prompt
  content.push({
    type: 'text',
    text: EXTRACTION_PROMPT
  });

  try {
    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: content
        }
      ]
    });

    // Parse the response
    const responseText = response.content[0].text;

    // Try to parse as JSON
    let extractedData;
    try {
      extractedData = JSON.parse(responseText);
    } catch (parseError) {
      // Try to extract JSON from the response if it has extra text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse extraction response as JSON');
      }
    }

    // Validate the response structure
    if (!extractedData.items || !Array.isArray(extractedData.items)) {
      throw new Error('Invalid extraction response: missing items array');
    }

    // Add metadata
    extractedData.filesProcessed = content.length - 1; // Subtract 1 for the text prompt
    extractedData.extractedAt = new Date().toISOString();

    return extractedData;

  } catch (error) {
    console.error('Claude API extraction error:', error);
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

/**
 * Extract consumption data from documents using Claude Vision
 * @param {Array<{buffer: Buffer, mimetype: string}>} files - Array of file objects
 * @returns {Promise<Object>} Extracted data with items array
 */
async function extractConsumptionDocument(files) {
  if (!files || files.length === 0) {
    throw new Error('No files provided for extraction');
  }

  // Build content array with all images
  const content = [];

  for (const file of files) {
    // Convert buffer to base64
    const base64Data = file.buffer.toString('base64');

    // Handle PDFs as document type, images as image type
    let mediaType = file.mimetype;
    if (mediaType === 'application/pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Data
        }
      });
    } else {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data
        }
      });
    }
  }

  if (content.length === 0) {
    throw new Error('No valid files to process.');
  }

  // Add the extraction prompt
  content.push({
    type: 'text',
    text: CONSUMPTION_EXTRACTION_PROMPT
  });

  try {
    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: content
        }
      ]
    });

    // Parse the response
    const responseText = response.content[0].text;

    // Try to parse as JSON
    let extractedData;
    try {
      extractedData = JSON.parse(responseText);
    } catch (parseError) {
      // Try to extract JSON from the response if it has extra text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse extraction response as JSON');
      }
    }

    // Validate the response structure
    if (!extractedData.items || !Array.isArray(extractedData.items)) {
      throw new Error('Invalid extraction response: missing items array');
    }

    // Add metadata
    extractedData.filesProcessed = content.length - 1;
    extractedData.extractedAt = new Date().toISOString();

    return extractedData;

  } catch (error) {
    console.error('Claude API extraction error:', error);
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

module.exports = {
  extractPackingList,
  extractConsumptionDocument
};
