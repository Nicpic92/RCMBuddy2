// CORRECTED VERSION of: netlify/functions/login.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body.' }) };
    }

    const { identifier, password } = body;
    if (!identifier || !password) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Username/Email and password are required.' }) };
    }

    try {
        // Find the user by either username OR email and get all necessary fields, including role and company_name
        const result = await pool.query(
            `SELECT u.id, u.username, u.email, u.password_hash, u.role, u.company_id, c.name as company_name
             FROM users u
             JOIN companies c ON u.company_id = c.id
             WHERE u.email = $1 OR u.username = $1`,
            [identifier]
        );
        const user = result.rows[0];

        if (!user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid credentials.' }) };
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid credentials.' }) };
        }

        // --- THIS IS THE FIX ---
        // Generate JWT with all user details INCLUDING the role.
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role, // <-- CRITICAL FIX: Add the user's role to the token payload
                company_id: user.company_id,
                company_name: user.company_name
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // Token expires in 1 hour
        );

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: 'Login successful!',
                token: token
            })
        };

    } catch (error) {
        console.error('Login error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Server error during login.' }) };
    }
};
