const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
    // This is the main logic block.
    try {
        if (event.httpMethod !== 'GET') {
            return { statusCode: 405, body: 'Method Not Allowed' };
        }

        const authHeader = event.headers.authorization;
        if (!authHeader) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Access denied. No token provided.' }) };
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Access denied. Token format is "Bearer [token]".' }) };
        }

        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decodedToken.id;

        const client = await pool.connect();
        try {
            const query = `
                SELECT u.id, u.username, u.email, u.role, u.company_id, c.name as company_name
                FROM users u
                JOIN companies c ON u.company_id = c.id
                WHERE u.id = $1;
            `;
            const { rows } = await client.query(query, [userId]);
            
            if (rows.length === 0) {
                return { statusCode: 404, body: JSON.stringify({ message: 'User not found.' }) };
            }

            const userData = rows[0];

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: 'Access granted.',
                    user: userData
                })
            };
        } finally {
            client.release();
        }

    } catch (error) {
        // --- THIS IS THE NEW "BLACK BOX RECORDER" CATCH BLOCK ---
        console.error("--- PROTECTED FUNCTION CRASHED ---", error);
        
        return {
            statusCode: 500, // Internal Server Error
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: "The protected function on the server encountered a critical error.",
                error_details: error.message,
                error_stack: error.stack // This will give us the exact line of the crash.
            })
        };
    }
};
