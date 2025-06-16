// netlify/functions/delete-data-dictionary.js
const jwt = require('jsonwebtoken'); // For JWT authentication
const { Pool } = require('pg');      // PostgreSQL client

// Initialize PostgreSQL pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Neon's SSL
});

exports.handler = async (event, context) => {
    console.log("delete-data-dictionary.js: Function started."); // NEW: Log function start

    // Ensure only DELETE requests are allowed
    if (event.httpMethod !== 'DELETE') {
        console.warn("delete-data-dictionary.js: Method Not Allowed:", event.httpMethod); // NEW: Log warning
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 1. Authenticate user and get company_id
    const authHeader = event.headers.authorization;
    if (!authHeader) {
        console.error("delete-data-dictionary.js: Authentication required: No Authorization header."); // NEW: Log error
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required.' }) };
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("delete-data-dictionary.js: JWT decoded successfully for user ID:", decoded.id, "Company ID:", decoded.company_id); // NEW: Log decoded info
    } catch (error) {
        console.error("delete-data-dictionary.js: JWT verification failed:", error.message); // NEW: Log error
        return { statusCode: 403, body: JSON.stringify({ message: 'Invalid or expired token.' }) };
    }
    const company_id = decoded.company_id; // CRUCIAL for data isolation

    // 2. Get the dictionary ID from request body
    let body;
    try {
        body = JSON.parse(event.body);
        console.log("delete-data-dictionary.js: Request body parsed:", body); // NEW: Log parsed body
    } catch (error) {
        console.error("delete-data-dictionary.js: Invalid JSON body received:", error.message); // NEW: Log error
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body.' }) };
    }
    const dictionaryId = body.id; // Expect 'id' in the body

    if (!dictionaryId) {
        console.error("delete-data-dictionary.js: Dictionary ID is required but missing from body."); // NEW: Log error
        return { statusCode: 400, body: JSON.stringify({ message: 'Dictionary ID is required.' }) };
    }

    // 3. Delete the specific data dictionary from the 'data_dictionaries' table
    let client;
    try {
        console.log("delete-data-dictionary.js: Attempting to connect to DB pool."); // NEW: Log DB connection attempt
        client = await pool.connect();
        console.log("delete-data-dictionary.js: Successfully connected to DB pool. Starting transaction."); // NEW: Log connection success
        await client.query('BEGIN'); // Start transaction

        console.log("delete-data-dictionary.js: Executing DELETE query for ID:", dictionaryId, "Company ID:", company_id); // NEW: Log query details
        const deleteResult = await client.query(
            `DELETE FROM data_dictionaries
             WHERE id = $1 AND company_id = $2 RETURNING id`, // RETURNING id to confirm deletion
            [dictionaryId, company_id]
        );

        if (deleteResult.rowCount === 0) {
            console.warn("delete-data-dictionary.js: Delete failed: Data dictionary not found or not authorized for ID:", dictionaryId); // NEW: Log warning
            await client.query('ROLLBACK'); // Rollback if no row was affected
            return { statusCode: 404, body: JSON.stringify({ message: 'Data dictionary not found or not authorized to delete.' }) };
        }

        await client.query('COMMIT'); // Commit the deletion
        console.log("delete-data-dictionary.js: Database transaction committed successfully."); // NEW: Log commit

        console.log("delete-data-dictionary.js: Data dictionary deleted successfully. Deleted ID:", dictionaryId); // NEW: Log success
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Data dictionary deleted successfully!', deletedId: dictionaryId })
        };

    } catch (dbError) {
        console.error('delete-data-dictionary.js: Database error deleting data dictionary:', dbError); // NEW: More comprehensive logging
        if (client) {
            console.warn("delete-data-dictionary.js: Attempting to rollback transaction due to error."); // NEW: Log rollback
            await client.query('ROLLBACK');
        }
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to delete data dictionary.', error: dbError.message }) };
    } finally {
        if (client) client.release();
        console.log("delete-data-dictionary.js: DB client released."); // NEW: Log client release
    }
};
