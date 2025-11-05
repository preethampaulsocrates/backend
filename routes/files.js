// backend/routes/files.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const Thesis = require('../models/Thesis');
const auth = require('../middleware/auth');
const router = express.Router();

// Download thesis file
router.get('/download/:thesisId', auth, async (req, res) => {
  try {
    console.log('=== FILE DOWNLOAD REQUEST ===');
    console.log('Thesis ID:', req.params.thesisId);
    console.log('User ID:', req.user.userId);
    console.log('User Role:', req.user.role);
    
    const thesis = await Thesis.findById(req.params.thesisId);
    
    if (!thesis) {
      console.log('Thesis not found in database');
      return res.status(404).json({ message: 'Thesis not found' });
    }

    // Check if file data exists
    if (!thesis.file || !thesis.file.path) {
      console.log('No file data in thesis');
      return res.status(404).json({ message: 'File data not found in database' });
    }

    console.log('File data from database:', thesis.file);
    
    // Construct absolute path
    const filePath = path.join(__dirname, '..', thesis.file.path);
    console.log('Looking for file at absolute path:', filePath);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log('File does not exist at path:', filePath);
      
      // Check uploads directory
      const uploadsDir = path.join(__dirname, '../uploads');
      console.log('Uploads directory exists:', fs.existsSync(uploadsDir));
      
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        console.log('Files in uploads directory:', files);
        
        // Check if file exists with different name
        const fileExists = files.some(f => f === thesis.file.filename);
        console.log('File exists in uploads with original filename:', fileExists);
      }
      
      return res.status(404).json({ message: 'File not found on server' });
    }

    console.log('File found! File size:', fs.statSync(filePath).size, 'bytes');
    
    // Check user permissions
    const userRole = req.user.role;
    const userId = req.user.userId;

    const canView = 
      userRole === 'scholar' && thesis.scholar.toString() === userId ||
      userRole === 'guide' && thesis.guide.toString() === userId ||
      ['librarian', 'registrar', 'vc'].includes(userRole);

    if (!canView) {
      console.log('Access denied for user:', userId, 'role:', userRole);
      return res.status(403).json({ message: 'Access denied' });
    }

    console.log('Sending file to client...');
    
    // Set headers and send file
    res.setHeader('Content-Type', thesis.file.mimetype || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${thesis.file.originalName}"`);
    
    res.sendFile(filePath);
    console.log('=== FILE SENT SUCCESSFULLY ===');
    
  } catch (error) {
    console.error('Error in file download:', error);
    res.status(500).json({ message: 'Error downloading file: ' + error.message });
  }
});

module.exports = router;