// netlify/functions/get-data-dictionary.js
const jwt = require('jsonwebtoken'); // For JWT authentication
const { Pool } = require('pg');      // PostgreSQL client

// Initialize PostgreSQL pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Neon's SSL
});

exports.handler = async (event, context) => {
    // Ensure only GET requests are allowed
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

    // 2. Get the dictionary ID from query parameters
    const dictionaryId = event.queryStringParameters.id;
    if (!dictionaryId) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Dictionary ID is required.' }) };
    }

    // 3. Fetch the specific data dictionary from the 'data_dictionaries' table
    let client;
    try {
        client = await pool.connect();
        const dictionaryResult = await client.query(
            `SELECT id, name, rules_json, source_headers_json, created_at, updated_at, user_id
             FROM data_dictionaries
             WHERE id = $1 AND company_id = $2`,
            [dictionaryId, company_id]
        );

        const dictionary = dictionaryResult.rows[0];

        if (!dictionary) {
            return { statusCode: 404, body: JSON.stringify({ message: 'Data dictionary not found or not accessible.' }) };
        }

        // Return the full dictionary details, including rules_json and updated_at
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Data dictionary retrieved successfully.',
                id: dictionary.id,
                name: dictionary.name,
                rules_json: dictionary.rules_json, // This is the actual JSON object/array
                source_headers_json: dictionary.source_headers_json, // Also a JSON object/array
                created_at: dictionary.created_at,
                updated_at: dictionary.updated_at, // NEW: Include updated_at
                user_id: dictionary.user_id
            })
        };

    } catch (dbError) {
        console.error('Database error retrieving data dictionary:', dbError);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to retrieve data dictionary.', error: dbError.message }) };
    } finally {
        if (client) client.release();
    }
};
