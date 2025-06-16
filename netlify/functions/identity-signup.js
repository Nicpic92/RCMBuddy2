// netlify/functions/identity-signup.js
const { Client } = require('pg');

exports.handler = async function(event) {
  const { user } = JSON.parse(event.body);

  // Connection details are pulled from Netlify's environment variables
  const client = new Client({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    // This query inserts the new user's Netlify ID and email into your 'users' table
    const query = `INSERT INTO users (id, email) VALUES ($1, $2)`;
    await client.query(query, [user.id, user.email]);
    await client.end();

    console.log(`Synced new user: ${user.email}`);
    return { statusCode: 200 };

  } catch (error) {
    await client.end();
    console.error('Error syncing user to Neon DB:', error);
    return { statusCode: 500, body: 'Internal Server Error.' };
  }
};
