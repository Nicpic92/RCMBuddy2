// netlify/functions/get-file.js
const jwt = require('jsonwebtoken'); // For JWT authentication
const { Pool } = require('pg');     // PostgreSQL client

// Initialize PostgreSQL pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
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
    const company_id = decoded.company_id; // CRUCIAL for data isolation

    // 2. Get file ID from query parameters
    const fileId = event.queryStringParameters.fileId;
    if (!fileId) {
        return { statusCode: 400, body: JSON.stringify({ message: 'File ID is required.' }) };
    }

    let client;
    try {
        client = await pool.connect();

        // 3. Retrieve file metadata and data from database, ensuring company isolation
        const fileResult = await client.query(
            `SELECT original_filename, mimetype, file_data
             FROM company_files
             WHERE id = $1 AND company_id = $2`, // IMPORTANT: Filter by company_id
            [fileId, company_id]
        );

        const fileRecord = fileResult.rows[0];

        if (!fileRecord) {
            // Return 404 if not found OR if it belongs to another company
            return { statusCode: 404, body: JSON.stringify({ message: 'File not found or not accessible.' }) };
        }

        // 4. Send the file data back as a binary response
        return {
            statusCode: 200,
            headers: {
                'Content-Type': fileRecord.mimetype, // Set the correct MIME type
                'Content-Disposition': `attachment; filename="${fileRecord.original_filename}"`, // Force download
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            },
            body: fileRecord.file_data.toString('base64'), // Convert BYTEA buffer to base64 for Netlify
            isBase64Encoded: true, // Tell Netlify the body is base64 encoded
        };

    } catch (dbError) {
        console.error('Database error retrieving file for download:', dbError);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to retrieve file for download.', error: dbError.message }) };
    } finally {
        if (client) client.release();
    }
};
