import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

async function createTestUser() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Check if usertest already exists
    const existingUser = await User.findOne({ username: 'usertest' });
    if (existingUser) {
      console.log('User "usertest" already exists');
      await mongoose.connection.close();
      return;
    }

    // Create the usertest user
    const user = new User({
      username: 'usertest',
      password: 'userpass',
      role: 'user',
      depot: 'Test Depot'
    });

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);

    await user.save();
    console.log('Created user: usertest with role: user');

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

createTestUser();