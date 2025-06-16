// netlify/functions/delete-file.js
const jwt = require('jsonwebtoken'); // For JWT authentication
const { Pool } = require('pg');     // PostgreSQL client

// Initialize PostgreSQL pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'DELETE') {
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
    const user_id = decoded.id;             // Optional: for logging/audit

    // 2. Get file ID from the request body
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body.' }) };
    }
    const fileId = body.fileId;
    if (!fileId) {
        return { statusCode: 400, body: JSON.stringify({ message: 'File ID is required for deletion.' }) };
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Start transaction

        // 3. Delete file record from database, ensuring company isolation
        // Return 'id' to confirm deletion and if a row was affected
        const deleteResult = await client.query(
            `DELETE FROM company_files
             WHERE id = $1 AND company_id = $2 RETURNING id`, // IMPORTANT: Filter by company_id
            [fileId, company_id]
        );

        if (deleteResult.rows.length === 0) {
            // File not found OR not owned by this company
            await client.query('ROLLBACK');
            return { statusCode: 404, body: JSON.stringify({ message: 'File not found or not accessible for deletion.' }) };
        }

        await client.query('COMMIT'); // Commit the deletion

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'File deleted successfully.', fileId: fileId })
        };

    } catch (dbError) {
        if (client) await client.query('ROLLBACK');
        console.error('Database error deleting file:', dbError);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to delete file.', error: dbError.message }) };
    } finally {
        if (client) client.release();
    }
};
