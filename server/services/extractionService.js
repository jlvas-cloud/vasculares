/**
 * Extraction Service
 * Uses Claude Vision API to extract data from packing list images
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
- Product stickers/labels from packaging
- Handwritten notes listing consumed items
- Typed consumption reports
- Any combination of formats

For each consumed item, extract what you can see:
- code: Product/article code (number, if visible - typically 6 digits for Orsiro products)
- name: Product name or description
- lotNumber: Lot/batch number (if visible, may be labeled "Lote", "Batch", "LOT")
- quantity: Number consumed (default to 1 if not specified)
- patientName: Patient name (if visible)
- doctorName: Doctor name (if visible)
- procedureDate: Date in YYYY-MM-DD format (if visible)

IMPORTANT:
- Extract ALL items you can identify
- If lot number is not visible, set lotNumber to null
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

    // Map mimetype to Claude's expected format
    let mediaType = file.mimetype;
    if (mediaType === 'application/pdf') {
      // For PDFs, we'll need to handle differently
      // For now, skip PDFs (future enhancement: convert to images)
      console.warn('PDF files not yet supported, skipping:', file.originalname);
      continue;
    }

    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64Data
      }
    });
  }

  if (content.length === 0) {
    throw new Error('No valid image files to process. PDF support coming soon.');
  }

  // Add the extraction prompt
  content.push({
    type: 'text',
    text: EXTRACTION_PROMPT
  });

  try {
    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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

    // Map mimetype to Claude's expected format
    let mediaType = file.mimetype;
    if (mediaType === 'application/pdf') {
      // For PDFs, we'll need to handle differently
      console.warn('PDF files not yet supported, skipping:', file.originalname);
      continue;
    }

    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64Data
      }
    });
  }

  if (content.length === 0) {
    throw new Error('No valid image files to process. PDF support coming soon.');
  }

  // Add the extraction prompt
  content.push({
    type: 'text',
    text: CONSUMPTION_EXTRACTION_PROMPT
  });

  try {
    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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
