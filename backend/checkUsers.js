import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function checkUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const users = await mongoose.connection.db.collection('users').find({}).toArray();
    console.log('Users in database:', users.length);
    users.forEach(user => {
      console.log(`- Username: ${user.username}, Role: ${user.role || 'N/A'}`);
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUsers();