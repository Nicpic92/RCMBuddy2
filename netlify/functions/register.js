// netlify/functions/register.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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
        console.error("Failed to parse request body:", error);
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body.' }) };
    }

    const { username, email, password, company_name } = body;

    if (!username || !email || !password || !company_name) {
        return { statusCode: 400, body: JSON.stringify({ message: 'All fields are required.' }) };
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Check if company exists to determine if this is the first user
        const companyResult = await client.query('SELECT id FROM companies WHERE name = $1', [company_name]);

        let companyId;
        let isFirstUserForCompany = false;

        if (companyResult.rows.length > 0) {
            companyId = companyResult.rows[0].id;
        } else {
            const newCompanyResult = await client.query(
                'INSERT INTO companies (name) VALUES ($1) RETURNING id',
                [company_name]
            );
            companyId = newCompanyResult.rows[0].id;
            isFirstUserForCompany = true; // This is the first user for a new company
        }

        // --- NEW LOGIC: Determine the user's role ---
        const userRole = isFirstUserForCompany ? 'admin' : 'user';

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // --- MODIFIED: Insert user with their new role ---
        const userResult = await client.query(
            'INSERT INTO users (username, email, password_hash, company_id, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email',
            [username, email, passwordHash, companyId, userRole]
        );
        const newUserId = userResult.rows[0].id;

        // --- NEW LOGIC: Assign tools based on role or company defaults ---
        if (isFirstUserForCompany) {
            // If they are the first user (admin), give them all tools
            await client.query(`
                INSERT INTO user_tools (user_id, tool_id)
                SELECT $1, id FROM tools
            `, [newUserId]);
        } else {
            // For subsequent users, assign tools based on the company's default settings
            await client.query(`
                INSERT INTO user_tools (user_id, tool_id)
                SELECT $1, t.id
                FROM tools t
                JOIN companies c ON t.identifier = ANY(SELECT jsonb_array_elements_text(c.default_tools))
                WHERE c.id = $2
            `, [newUserId, companyId]);
        }

        await client.query('COMMIT');

        return {
            statusCode: 201,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: 'User registered successfully!',
                user: { id: userResult.rows[0].id, username: userResult.rows[0].username, email: userResult.rows[0].email },
                company_id: companyId,
                company_name: company_name
            })
        };

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        if (error.code === '23505') {
            return { statusCode: 409, body: JSON.stringify({ message: 'Username or email already exists.' }) };
        }
        console.error('Registration error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Server error during registration.' }) };
    } finally {
        if (client) client.release();
    }
};
