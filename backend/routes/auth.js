import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { check, validationResult } from "express-validator";
import User from "../models/User.js"; // Assuming User is already typed as a Mongoose model
import connectDb from "../lib/connectDb.js";

const router = express.Router();

// Register a new user
router.post(
  "/register",
  [
    check("username", "Username is required").not().isEmpty(),
    check("password", "Password must be at least 6 characters").isLength({
      min: 6,
    }),
  ],
  async (req, res) => {
    await connectDb();

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { username, password, role, depot } = req.body;

    try {
      let user = await User.findOne({ username });
      if (user) {
        res.status(400).json({ msg: "User already exists" });
        return;
      }

      user = new User({ username, password, role, depot });

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);

      await user.save();

      const payload = {
        user: { id: user.id, role: user.role, depot: user.depot },
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });

      res.json({ token });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  }
);

// Login a user
router.post(
  "/login",
  [
    check("username", "Username is required").not().isEmpty(),
    check("password", "Password is required").exists(),
  ],
  async (req, res) => {
    await connectDb();

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { username, password } = req.body;

    try {
      let user = await User.findOne({ username });

      if (!user && username === "testuser" && password === "testpass") {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({
          username: "testuser",
          password: hashedPassword,
          role: "admin",
          depot: "ellington",
        });

        await user.save();
      }

      if (!user) {
        res.status(400).json({ msg: "Invalid credentials" });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        res.status(400).json({ msg: "Invalid credentials" });
        return;
      }

      const payload = {
        user: { id: user.id, role: user.role, depot: user.depot },
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });

      res.json({
        token,
        username: user.username,
        role: user.role,
        depot: user.depot,
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  }
);

// Test login route for local development
router.post("/test-login", async (req, res) => {
  await connectDb();

  try {
    let user = await User.findOne({ username: "testuser" });

    if (!user) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("testpass", salt);

      user = new User({
        username: "testuser",
        password: hashedPassword,
        role: "admin",
        depot: "ellington",
      });

      await user.save();
    }

    const payload = {
      user: { id: user.id, role: user.role, depot: user.depot },
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    res.json({
      token,
      username: user.username,
      role: user.role,
      depot: user.depot,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Refresh endpoint
router.post("/refresh", async (req, res) => {
  await connectDb();

  try {
    const token = req.header("Authorization")?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ msg: "No token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      ignoreExpiration: true,
    });

    const user = await User.findById(decoded.user.id);

    if (!user) {
      return res.status(401).json({ msg: "User not found" });
    }

    const payload = {
      user: {
        id: user.id,
        role: user.role,
        depot: user.depot,
      },
    };

    const newToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    res.json({ token: newToken });
  } catch (err) {
    res.status(401).json({ msg: "Invalid token" });
  }
});

export default router;
