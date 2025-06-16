// Full code for: netlify/functions/admin/update-user-tools.js

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
    // Return the admin's company ID to ensure they can't modify other companies
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
        const { userIdToUpdate, toolIdentifiers } = JSON.parse(event.body);

        // Basic validation on the received data
        if (!userIdToUpdate || !Array.isArray(toolIdentifiers)) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body. Required: userIdToUpdate, toolIdentifiers array.' }) };
        }

        const client = await pool.connect();
        try {
            // 3. Start a database transaction for safety. All steps must succeed or none will.
            await client.query('BEGIN');

            // 4. CRITICAL SECURITY CHECK: Verify the user being updated belongs to the admin's own company.
            const userCheck = await client.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [userIdToUpdate, companyId]);
            if (userCheck.rows.length === 0) {
                // This prevents an admin from one company from editing users of another company
                throw new Error('Forbidden. Cannot update a user from another company.');
            }

            // 5. Clear all existing tool assignments for this user to ensure a fresh start
            await client.query('DELETE FROM user_tools WHERE user_id = $1', [userIdToUpdate]);

            // 6. If the admin assigned any tools, insert the new permissions
            if (toolIdentifiers && toolIdentifiers.length > 0) {
                // First, get the integer IDs for the tool identifiers (e.g., 'data-cleaner' -> 1)
                const toolIdsQuery = 'SELECT id FROM tools WHERE identifier = ANY($1::varchar[])';
                const toolIdsResult = await client.query(toolIdsQuery, [toolIdentifiers]);
                
                // If any of the tool identifiers were invalid, this might be empty
                if (toolIdsResult.rows.length > 0) {
                    const toolIds = toolIdsResult.rows.map(r => r.id);
                    // Prepare a query to insert all the new user-tool pairs at once
                    const insertValues = toolIds.map(toolId => `(${userIdToUpdate}, ${toolId})`).join(',');
                    await client.query(`INSERT INTO user_tools (user_id, tool_id) VALUES ${insertValues}`);
                }
            }

            // 7. If all steps succeeded, commit the transaction to save the changes
            await client.query('COMMIT');

            return { 
                statusCode: 200, 
                body: JSON.stringify({ message: 'User permissions updated successfully.' }) 
            };
        } catch (e) {
            // If any error occurred during the transaction, roll everything back
            await client.query('ROLLBACK');
            throw e; // Re-throw the error to be caught by the outer catch block
        } finally {
            // Always release the database client
            client.release();
        }

    } catch (error) {
        console.error('Update user tools error:', error);
        return { 
            statusCode: error.message.startsWith('Forbidden') ? 403 : 500,
            body: JSON.stringify({ message: error.message }) 
        };
    }
};
