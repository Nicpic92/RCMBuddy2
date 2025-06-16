// Full code for: netlify/functions/admin/update-company-defaults.js

const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Helper function to verify the user is an admin
const authenticateAdmin = (authHeader) => {
    if (!authHeader) throw new Error('Access denied. No token provided.');
    const token = authHeader.split(' ')[1];
    if (!token) throw new Error('Access denied. Token format is "Bearer [token]".');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'admin') {
        throw new Error('Forbidden. User is not an administrator.');
    }
    return { companyId: decoded.company_id };
};

exports.handler = async (event, context) => {
    // This function only accepts POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Authenticate the request to ensure it's from a valid admin
        const { companyId } = authenticateAdmin(event.headers.authorization);

        // 2. Parse the incoming data from the admin.html page
        const { defaultToolIdentifiers } = JSON.parse(event.body);

        if (!Array.isArray(defaultToolIdentifiers)) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body. Required: defaultToolIdentifiers array.' }) };
        }

        // 3. Convert the JavaScript array of strings into a JSON string suitable for a JSONB database column
        const defaultsJson = JSON.stringify(defaultToolIdentifiers);

        // 4. Update the 'companies' table, setting the new default_tools value for the admin's company
        await pool.query(
            'UPDATE companies SET default_tools = $1 WHERE id = $2', 
            [defaultsJson, companyId]
        );
        
        return { 
            statusCode: 200, 
            body: JSON.stringify({ message: 'Company default tools updated successfully.' }) 
        };

    } catch (error) {
        console.error('Update company defaults error:', error);
        return { 
            statusCode: error.message.startsWith('Forbidden') ? 403 : 500,
            body: JSON.stringify({ message: error.message }) 
        };
    }
};
