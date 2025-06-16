// netlify/functions/clean-excel.js
const Busboy = require('busboy'); // For parsing multipart/form-data (file uploads)
const exceljs = require('exceljs'); // For reading, manipulating, and writing Excel files
const { Readable } = require('stream'); // Node.js stream utility
const jwt = require('jsonwebtoken'); // For JWT verification to get company_id

/**
 * Helper function to parse multipart/form-data from Netlify Function event.
 * @param {object} event - The Netlify Function event object.
 * @returns {Promise<{fields: object, files: object}>} - An object containing form fields and files.
 */
function parseMultipartForm(event) {
    return new Promise((resolve, reject) => {
        const busboy = Busboy({ headers: event.headers });
        const fields = {};
        const files = {};
        let fileBuffer = Buffer.from(''); // Buffer to accumulate file data

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            file.on('data', (data) => {
                fileBuffer = Buffer.concat([fileBuffer, data]);
            });
            file.on('end', () => {
                files[fieldname] = {
                    filename,
                    encoding,
                    mimetype,
                    data: fileBuffer // Store the accumulated buffer
                };
            });
        });

        busboy.on('field', (fieldname, val) => {
            fields[fieldname] = val;
        });

        busboy.on('finish', () => {
            resolve({ fields, files });
        });

        busboy.on('error', reject);

        // Convert the event body to a readable stream for Busboy
        const readableStream = new Readable();
        readableStream.push(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
        readableStream.push(null); // End the stream

        readableStream.pipe(busboy);
    });
}

/**
 * Helper function to apply cleaning operations to a worksheet.
 * @param {exceljs.Worksheet} worksheet - The ExcelJS worksheet object.
 * @param {object} options - Cleaning options (removeDuplicates, trimSpaces, standardizeText).
 * @returns {object} - Summary of changes made.
 */
function cleanWorksheet(worksheet, options) {
    let removedDuplicates = 0;
    let trimmedSpaces = 0;
    let standardizedText = 0;

    // Convert worksheet to an array of rows for easier manipulation
    let rows = [];
    worksheet.eachRow((row, rowNumber) => {
        // Skip header row if needed, assuming first row is header
        if (rowNumber === 1 && options.firstRowHeader) { // Add option if you want to skip header
            rows.push(row.values); // Store header as is
            return;
        }
        rows.push(row.values);
    });

    // 1. Trim Extra Spaces
    if (options.trimSpaces === 'true') { // Busboy fields are strings
        rows = rows.map(row => row.map(cell => {
            if (typeof cell === 'string') {
                const originalLength = cell.length;
                const trimmedCell = cell.trim();
                if (trimmedCell.length < originalLength) {
                    trimmedSpaces++;
                }
                return trimmedCell;
            }
            return cell;
        }));
    }

    // 2. Standardize Text Case (e.g., Proper Case/Title Case)
    if (options.standardizeText === 'true') { // Busboy fields are strings
        rows = rows.map(row => row.map(cell => {
            if (typeof cell === 'string') {
                const originalCell = cell;
                // Simple Proper Case: Capitalize first letter of each word
                const standardizedCell = cell.toLowerCase().split(' ').map(word => {
                    return word.charAt(0).toUpperCase() + word.slice(1);
                }).join(' ');

                if (standardizedCell !== originalCell) {
                    standardizedText++;
                }
                return standardizedCell;
            }
            return cell;
        }));
    }

    // 3. Remove Duplicate Rows
    if (options.removeDuplicates === 'true') { // Busboy fields are strings
        const uniqueRows = new Set();
        const cleanedRows = [];
        rows.forEach(row => {
            // Create a string representation of the row for Set uniqueness check
            const rowString = JSON.stringify(row);
            if (!uniqueRows.has(rowString)) {
                uniqueRows.add(rowString);
                cleanedRows.push(row);
            } else {
                removedDuplicates++;
            }
        });
        rows = cleanedRows;
    }

    // Clear existing rows in worksheet and add cleaned data
    worksheet.spliceRows(1, worksheet.actualRowCount); // Remove all existing rows
    rows.forEach(row => {
        worksheet.addRow(row);
    });

    return { removedDuplicates, trimmedSpaces, standardizedText };
}

/**
 * Netlify Function handler for cleaning Excel files.
 * Expects a POST request with multipart/form-data containing the Excel file and cleaning options.
 */
exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    // Authenticate and get company_id from JWT (REQUIRED for data isolation)
    const authHeader = event.headers.authorization;
    if (!authHeader) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required.' }) };
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication token missing.' }) };
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        // If token is invalid/expired, return 403 Forbidden
        return { statusCode: 403, body: JSON.stringify({ message: 'Invalid or expired token.' }) };
    }
    const company_id = decoded.company_id; // Extract company_id from the authenticated user's JWT
    const user_id = decoded.id; // Extract user_id (optional, but good for logging who did what)

    // Ensure the request is multipart/form-data
    if (!event.headers['content-type'] || !event.headers['content-type'].includes('multipart/form-data')) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Content-Type must be multipart/form-data' })
        };
    }

    try {
        const { fields, files } = await parseMultipartForm(event);
        const excelFile = files.excelFile; // 'excelFile' is the name attribute from the input type="file"

        if (!excelFile || !excelFile.data) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'No Excel file uploaded.' })
            };
        }

        const workbook = new exceljs.Workbook();
        await workbook.xlsx.load(excelFile.data); // Load the uploaded Excel file from buffer

        let cleaningSummary = { removedDuplicates: 0, trimmedSpaces: 0, standardizedText: 0 };

        // Process each worksheet in the workbook
        workbook.eachSheet((worksheet, id) => {
            const sheetSummary = cleanWorksheet(worksheet, fields); // Pass cleaning options
            cleaningSummary.removedDuplicates += sheetSummary.removedDuplicates;
            cleaningSummary.trimmedSpaces += sheetSummary.trimmedSpaces;
            cleaningSummary.standardizedText += sheetSummary.standardizedText;
        });

        // Write the cleaned workbook to a buffer
        const cleanedFileBuffer = await workbook.xlsx.writeBuffer();

        // --- IMPORTANT FOR MULTI-COMPANY DATA ISOLATION ---
        // If you were to save a record of this cleaning event or the file itself to your database,
        // you would NOW include `company_id` (and potentially `user_id`) in that database record.
        // This is where you enforce that only data for the current company is handled/stored.
        // For example (this is conceptual, not implemented here):
        /*
        const { Pool } = require('pg'); // Need to re-require if not already at top for this block
        const dbPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await dbPool.query(
             'INSERT INTO cleaning_logs (user_id, company_id, original_file_name, cleaned_summary, cleaned_file_size_kb) VALUES ($1, $2, $3, $4, $5)',
             [user_id, company_id, excelFile.filename, JSON.stringify(cleaningSummary), cleanedFileBuffer.length / 1024]
        );
        */

        // Respond with the cleaned file as base64 and the summary
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json', // We're sending JSON, not the file directly
            },
            body: JSON.stringify({
                message: 'File cleaned successfully!',
                cleanedFileBase64: cleanedFileBuffer.toString('base64'), // Convert buffer to base64 string
                summary: cleaningSummary,
                fileName: `cleaned_${excelFile.filename}` // Suggest a new file name
            })
        };

    } catch (error) {
        console.error('Error in clean-excel function:', error);
        // Provide more detailed error message if it's a known error type, otherwise generic
        let userFacingError = 'Error processing Excel file.';
        if (error.message.includes('file format')) {
            userFacingError = 'Invalid Excel file format. Please upload a valid .xlsx or .xls file.';
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ message: userFacingError, error: error.message })
        };
    }
};
