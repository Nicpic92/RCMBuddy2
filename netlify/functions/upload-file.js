// netlify/functions/upload-file.js
const Busboy = require('busboy'); // For parsing multipart/form-data
const jwt = require('jsonwebtoken'); // For JWT authentication
const { Pool } = require('pg');     // PostgreSQL client

// Initialize PostgreSQL pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

/**
 * Helper to parse multipart/form-data from Netlify Function event.
 * @param {object} event - The Netlify Function event object.
 * @returns {Promise<{fields: object, files: object}>}
 */
function parseMultipartForm(event) {
    return new Promise((resolve, reject) => {
        const busboy = Busboy({ headers: event.headers });
        const fields = {};
        const files = {};
        let fileBuffer = Buffer.from('');

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            file.on('data', (data) => { fileBuffer = Buffer.concat([fileBuffer, data]); });
            file.on('end', () => {
                files[fieldname] = { filename, encoding, mimetype, data: fileBuffer };
            });
        });
        busboy.on('field', (fieldname, val) => { fields[fieldname] = val; });
        busboy.on('finish', () => { resolve({ fields, files }); });
        busboy.on('error', reject);

        // Convert event body to a readable stream
        const readableStream = new require('stream').Readable();
        readableStream.push(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
        readableStream.push(null);
        readableStream.pipe(busboy);
    });
}

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 1. Authenticate user and get company_id
    const authHeader = event.headers.authorization;
    if (!authHeader) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required.' }) };
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return { statusCode: 403, body: JSON.stringify({ message: 'Invalid or expired token.' }) };
    }
    const user_id = decoded.id;
    const company_id = decoded.company_id; // CRUCIAL for data isolation

    // 2. Parse file upload
    if (!event.headers['content-type'] || !event.headers['content-type'].includes('multipart/form-data')) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Content-Type must be multipart/form-data.' }) };
    }

    try {
        const { fields, files } = await parseMultipartForm(event);
        const uploadedFile = files.file; // 'file' is the name attribute from the input type="file"
        const isDataDictionary = fields.isDataDictionary === 'true'; // Get boolean from form field

        if (!uploadedFile || !uploadedFile.data) {
            return { statusCode: 400, body: JSON.stringify({ message: 'No file uploaded.' }) };
        }

        // --- Store file data directly in PostgreSQL (Neon) ---
        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN'); // Start transaction for atomicity

            // Insert file metadata AND binary data into company_files table
            const insertResult = await client.query(
                `INSERT INTO company_files (company_id, user_id, original_filename, mimetype, size_bytes, file_data, is_data_dictionary)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [company_id, user_id, uploadedFile.filename, uploadedFile.mimetype, uploadedFile.data.length, uploadedFile.data, isDataDictionary] // Pass isDataDictionary
            );
            await client.query('COMMIT'); // Commit the transaction

            const newFileId = insertResult.rows[0].id;

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'File uploaded successfully to Neon!', fileId: newFileId, fileName: uploadedFile.filename })
            };

        } catch (dbError) {
            if (client) await client.query('ROLLBACK'); // Rollback on error
            console.error('Database error storing file:', dbError);
            return { statusCode: 500, body: JSON.stringify({ message: 'Failed to save file to database.', error: dbError.message }) };
        } finally {
            if (client) client.release(); // Release client back to pool
        }

    } catch (error) {
        console.error('File upload function error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to upload file.', error: error.message }) };
    }
};
