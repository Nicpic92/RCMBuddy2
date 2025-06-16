const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// Set up the database connection pool. It will use the DATABASE_URL environment variable.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Your authentication function - this is good, we will use it.
const authenticateAdmin = (authHeader) => {
    if (!authHeader) {
        throw new Error('Access denied. No token provided.');
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        throw new Error('Access denied. Token format is "Bearer [token]".');
    }
    
    // Verify the token is valid
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check for admin role from the token
    if (decoded.role !== 'admin') {
        throw new Error('Forbidden. User is not an administrator.');
    }
    
    // If they are an admin, return their company ID
    return { companyId: decoded.company_id };
};

// The main handler function that Netlify will run.
exports.handler = async (event, context) => {
    // We only allow GET requests to this endpoint.
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    try {
        // Step 1: Authenticate the request and get the company ID.
        // This will throw an error if the user is not a valid admin, which the catch block will handle.
        const { companyId } = authenticateAdmin(event.headers.authorization);

        // Step 2: Fetch all necessary data from the database for that company.
        const client = await pool.connect();
        try {
            // We run all our queries in parallel for better performance.
            const [usersRes, toolsRes, companyRes, userToolsRes] = await Promise.all([
                // Get all users in the company
                client.query('SELECT id, username, email FROM users WHERE company_id = $1 ORDER BY username', [companyId]),
                // Get all available tools (assuming tools are global)
                client.query('SELECT id, identifier, display_name FROM tools ORDER BY display_name'),
                // Get the company's default tool settings
                client.query('SELECT default_tools FROM companies WHERE id = $1', [companyId]),
                // Get all tool assignments for every user in the company
                client.query(`
                    SELECT ut.user_id, t.identifier 
                    FROM user_tools ut 
                    JOIN tools t ON ut.tool_id = t.id
                    WHERE ut.user_id IN (SELECT id FROM users WHERE company_id = $1)
                `, [companyId])
            ]);

            // Step 3: Format the data for the front-end.
            
            // Create a map of { userId: ['tool1', 'tool2'] }
            const userToolMap = userToolsRes.rows.reduce((acc, row) => {
                if (!acc[row.user_id]) {
                    acc[row.user_id] = [];
                }
                acc[row.user_id].push(row.identifier);
                return acc;
            }, {});

            const responsePayload = {
                message: 'Admin data retrieved successfully.',
                users: usersRes.rows,
                all_available_tools: toolsRes.rows,
                company_defaults: companyRes.rows[0]?.default_tools || [],
                user_tool_map: userToolMap
            };

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(responsePayload)
            };

        } finally {
            // This is critical to prevent running out of database connections.
            client.release();
        }

    } catch (error) {
        // If anything goes wrong (authentication, database query, etc.), send back an error.
        console.error('Error in get-company-admin-data:', error.message);
        return {
            statusCode: error.message.includes('Forbidden') ? 403 : 401,
            body: JSON.stringify({ message: error.message })
        };
    }
};
