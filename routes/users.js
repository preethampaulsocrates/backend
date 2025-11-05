const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/guides', auth, async (req, res) => {
  try {
    const guides = await User.find({ role: 'guide' }).select('name email department');
    res.json(guides);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;