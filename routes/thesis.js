// backend/routes/thesis.js - CORRECTED VERSION
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Thesis = require('../models/Thesis');
const auth = require('../middleware/auth');
const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.\-]/g, '_');
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + cleanName;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Word documents are allowed'));
    }
  }
});

// Upload thesis
router.post('/upload', auth, upload.single('thesisFile'), async (req, res) => {
  try {
    const { title, abstract, keywords, guideId } = req.body;
    
    console.log('=== FILE UPLOAD DEBUG ===');
    console.log('Uploaded file:', req.file);
    
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const relativePath = 'uploads/' + req.file.filename;
    
    const thesis = new Thesis({
      title,
      abstract,
      keywords: keywords.split(','),
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: relativePath,
        mimetype: req.file.mimetype,
        size: req.file.size
      },
      scholar: req.user.userId,
      guide: guideId,
      status: 'submitted',
      currentStage: 'guide'
    });

    await thesis.save();
    await thesis.populate('guide', 'name email department');
    await thesis.populate('scholar', 'name email scholarId');

    console.log('Thesis saved with file path:', relativePath);
    console.log('=== UPLOAD COMPLETE ===');

    res.status(201).json({ message: 'Thesis uploaded successfully', thesis });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Error uploading thesis', error: error.message });
  }
});

// Get theses for current user based on role
router.get('/my-theses', auth, async (req, res) => {
  try {
    console.log('=== MY-THESES API CALLED ===');
    console.log('User ID:', req.user.userId);
    console.log('User Role:', req.user.role);
    
    let query = {};
    const userRole = req.user.role;

    switch (userRole) {
      case 'scholar':
        query = { scholar: req.user.userId };
        console.log('Scholar query: find theses where scholar =', req.user.userId);
        break;
      case 'guide':
        query = { guide: req.user.userId };
        console.log('Guide query: find theses where guide =', req.user.userId);
        break;
      case 'librarian':
        query = { status: 'guide_approved' };
        console.log('Librarian query: find theses with status guide_approved');
        break;
      case 'registrar':
        query = { status: 'librarian_reviewed', 'approvals.guide.status': 'approved' };
        console.log('Registrar query: find approved theses reviewed by librarian');
        break;
      case 'vc':
        query = { status: 'registrar_reviewed' };
        console.log('VC query: find theses reviewed by registrar');
        break;
      default:
        query = {};
        console.log('Default query: no filter');
    }

    const theses = await Thesis.find(query)
      .populate('scholar', 'name email scholarId department')
      .populate('guide', 'name email department')
      .sort({ createdAt: -1 });

    console.log('Found', theses.length, 'theses');
    console.log('Theses data:', JSON.stringify(theses, null, 2));
    console.log('=== MY-THESES COMPLETE ===');
    
    res.json(theses);
  } catch (error) {
    console.error('Error in my-theses route:', error);
    res.status(500).json({ message: 'Error fetching theses', error: error.message });
  }
});

// Test route to get all theses
router.get('/test-all', auth, async (req, res) => {
  try {
    console.log('=== TEST ALL THESES ===');
    const allTheses = await Thesis.find()
      .populate('scholar', 'name email')
      .populate('guide', 'name email')
      .sort({ createdAt: -1 });
    
    console.log('Total theses in database:', allTheses.length);
    
    res.json({
      total: allTheses.length,
      theses: allTheses
    });
  } catch (error) {
    console.error('Error in test-all:', error);
    res.status(500).json({ message: 'Error fetching all theses', error: error.message });
  }
});

// Guide approves/rejects thesis
router.put('/guide-action/:id', auth, async (req, res) => {
  try {
    const { action, comment } = req.body;
    
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }

    thesis.approvals.guide = {
      status: action,
      comment,
      date: new Date()
    };

    if (action === 'approved') {
      thesis.status = 'guide_approved';
      thesis.currentStage = 'librarian';
    } else {
      thesis.status = 'guide_rejected';
      thesis.currentStage = 'guide';
    }

    await thesis.save();
    res.json({ message: `Thesis ${action} by guide`, thesis });
  } catch (error) {
    res.status(500).json({ message: 'Error processing action', error: error.message });
  }
});

// Librarian reviews plagiarism - UPDATED VERSION WITH PASS/FAIL
router.put('/librarian-review/:id', auth, async (req, res) => {
  try {
    const { plagiarismPercentage, report, comment, status } = req.body;
    
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }

    // Check if user is librarian
    if (req.user.role !== 'librarian') {
      return res.status(403).json({ message: 'Only librarians can perform this action' });
    }

    // Check if thesis is ready for librarian review
    if (thesis.status !== 'guide_approved' || thesis.currentStage !== 'librarian') {
      return res.status(400).json({ message: 'Thesis is not ready for librarian review' });
    }

    if (!plagiarismPercentage || !report || !status) {
      return res.status(400).json({ message: 'Plagiarism percentage, report, and status are required' });
    }

    if (!['passed', 'failed'].includes(status)) {
      return res.status(400).json({ message: 'Status must be either "passed" or "failed"' });
    }

    // Update thesis based on plagiarism check result
    if (status === 'passed') {
      thesis.status = 'librarian_reviewed';
      thesis.currentStage = 'registrar';
    } else {
      thesis.status = 'librarian_rejected';
      thesis.currentStage = 'guide';
    }

    // Update librarian approval
    thesis.approvals.librarian = {
      date: new Date(),
      plagiarismPercentage: plagiarismPercentage,
      report: report,
      comment: comment || '',
      status: status
    };

    thesis.updatedAt = new Date();

    await thesis.save();

    res.json({ 
      message: `Plagiarism check ${status} successfully`,
      thesis 
    });

  } catch (error) {
    console.error('Error in librarian review:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Registrar action
router.put('/registrar-action/:id', auth, async (req, res) => {
  try {
    const { action, comment } = req.body;
    
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }

    thesis.approvals.registrar = {
      status: action,
      comment,
      date: new Date()
    };

    if (action === 'approved') {
      thesis.status = 'registrar_reviewed';
      thesis.currentStage = 'vc';
    } else {
      thesis.status = 'registrar_rejected';
      thesis.currentStage = 'guide';
    }

    await thesis.save();
    res.json({ message: `Thesis ${action} by registrar`, thesis });
  } catch (error) {
    res.status(500).json({ message: 'Error processing action', error: error.message });
  }
});

// VC action
router.put('/vc-action/:id', auth, async (req, res) => {
  try {
    const { action, comment } = req.body;
    
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }

    thesis.approvals.vc = {
      status: action,
      comment,
      date: new Date()
    };

    if (action === 'approved') {
      thesis.status = 'vc_reviewed';
      thesis.currentStage = 'final';
    } else {
      thesis.status = 'vc_rejected';
      thesis.currentStage = 'guide';
    }

    await thesis.save();
    res.json({ message: `Thesis ${action} by VC`, thesis });
  } catch (error) {
    res.status(500).json({ message: 'Error processing action', error: error.message });
  }
});

// Guide final approval after VC - UPDATED WITH DEBUGGING
router.put('/final-approval/:id', auth, async (req, res) => {
  try {
    console.log('=== FINAL APPROVAL REQUEST ===');
    console.log('Thesis ID:', req.params.id);
    console.log('User ID:', req.user.userId);
    console.log('User Role:', req.user.role);
    console.log('Request body:', req.body);

    const { action, comment } = req.body;
    
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      console.log('Thesis not found');
      return res.status(404).json({ message: 'Thesis not found' });
    }

    console.log('Current thesis status:', thesis.status);
    console.log('Current thesis stage:', thesis.currentStage);
    console.log('Current approvals:', thesis.approvals);

    // Validate that thesis is in correct state for final approval
    if (thesis.status !== 'vc_reviewed' || thesis.currentStage !== 'final') {
      console.log('Thesis not ready for final approval. Status:', thesis.status, 'Stage:', thesis.currentStage);
      return res.status(400).json({ 
        message: 'Thesis not ready for final approval. Must be VC reviewed and in final stage.' 
      });
    }

    thesis.approvals.final = {
      status: action,
      comment: comment || '',
      date: new Date()
    };

    if (action === 'approved') {
      thesis.status = 'approved';
      thesis.currentStage = 'completed';
      console.log('Thesis fully approved');
    } else if (action === 'rejected') {
      thesis.status = 'rejected';
      thesis.currentStage = 'completed';
      console.log('Thesis rejected in final stage');
    } else {
      console.log('Invalid action:', action);
      return res.status(400).json({ message: 'Invalid action. Use "approved" or "rejected".' });
    }

    await thesis.save();
    
    console.log('Thesis after final approval:', {
      status: thesis.status,
      currentStage: thesis.currentStage,
      finalApproval: thesis.approvals.final
    });
    
    console.log('=== FINAL APPROVAL COMPLETE ===');

    res.json({ 
      message: `Thesis ${action} finally`,
      thesis: {
        id: thesis._id,
        status: thesis.status,
        currentStage: thesis.currentStage,
        approvals: thesis.approvals
      }
    });
  } catch (error) {
    console.error('Error in final approval:', error);
    res.status(500).json({ 
      message: 'Error processing final approval', 
      error: error.message 
    });
  }
});

// Check thesis state for final approval - ADD THIS NEW ROUTE
router.get('/check-final/:id', auth, async (req, res) => {
  try {
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }
    
    res.json({
      thesis: {
        id: thesis._id,
        title: thesis.title,
        status: thesis.status,
        currentStage: thesis.currentStage,
        approvals: thesis.approvals,
        canFinalApprove: thesis.status === 'vc_reviewed' && thesis.currentStage === 'final'
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error checking thesis', error: error.message });
  }
});

// Debug route
router.get('/debug/:id', auth, async (req, res) => {
  try {
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }
    
    res.json({
      thesis: {
        id: thesis._id,
        title: thesis.title,
        file: thesis.file,
        scholar: thesis.scholar,
        guide: thesis.guide,
        status: thesis.status,
        currentStage: thesis.currentStage,
        approvals: thesis.approvals
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching thesis', error: error.message });
  }
});

// Guide sends thesis for re-approval after rejection
router.put('/guide-reapproval/:id', auth, async (req, res) => {
  try {
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }

    // Check if guide is authorized
    if (thesis.guide._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Not authorized to perform this action' });
    }

    // Check if thesis is in rejected state and with guide
    if (!['librarian_rejected', 'registrar_rejected', 'vc_rejected'].includes(thesis.status) || thesis.currentStage !== 'guide') {
      return res.status(400).json({ message: 'Thesis is not in a state that can be sent for re-approval' });
    }

    const { comment, target } = req.body;

    if (!['librarian', 'registrar', 'vc'].includes(target)) {
      return res.status(400).json({ message: 'Invalid target for re-approval' });
    }

    // Update thesis status and stage based on target
    let newStatus = 'submitted';
    let newStage = 'guide';

    if (target === 'librarian') {
      newStatus = 'guide_approved';
      newStage = 'librarian';
    } else if (target === 'registrar') {
      newStatus = 'librarian_reviewed';
      newStage = 'registrar';
    } else if (target === 'vc') {
      newStatus = 'registrar_reviewed';
      newStage = 'vc';
    }

    // Add re-approval request to approvals
    thesis.approvals.guideReapproval = {
      date: new Date(),
      comment: comment,
      target: target,
      originalRejector: thesis.status.replace('_rejected', '')
    };

    // Update thesis status and stage
    thesis.status = newStatus;
    thesis.currentStage = newStage;
    thesis.updatedAt = new Date();

    await thesis.save();

    res.json({ 
      message: 'Thesis sent for re-approval successfully',
      thesis 
    });

  } catch (error) {
    console.error('Error in guide re-approval:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Guide final rejection (sends to scholar as final rejection)
router.put('/final-rejection/:id', auth, async (req, res) => {
  try {
    const thesis = await Thesis.findById(req.params.id);
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }

    // Check if guide is authorized
    if (thesis.guide._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Not authorized to perform this action' });
    }

    // Check if thesis is in rejected state and with guide
    if (!['librarian_rejected', 'registrar_rejected', 'vc_rejected'].includes(thesis.status) || thesis.currentStage !== 'guide') {
      return res.status(400).json({ message: 'Thesis is not in a state that can be finally rejected' });
    }

    const { comment } = req.body;

    // Update thesis to final rejected state
    thesis.status = 'rejected';
    thesis.currentStage = 'scholar';
    thesis.updatedAt = new Date();

    // Add final rejection note
    thesis.approvals.finalRejection = {
      date: new Date(),
      comment: comment || 'Thesis finally rejected by guide',
      rejectedBy: 'guide',
      originalRejector: thesis.status.replace('_rejected', '')
    };

    await thesis.save();

    res.json({ 
      message: 'Thesis finally rejected successfully',
      thesis 
    });

  } catch (error) {
    console.error('Error in final rejection:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add this route to create a test rejected thesis
router.post('/create-test-rejected', auth, async (req, res) => {
  try {
    // Create a test thesis with librarian_rejected status
    const testThesis = new Thesis({
      title: 'TEST - Librarian Rejected Thesis',
      abstract: 'This is a test thesis for re-approval functionality',
      keywords: ['test', 'librarian', 'rejected'],
      scholar: req.user.userId,
      guide: req.user.userId, // Using same user as guide for testing
      status: 'librarian_rejected',
      currentStage: 'guide',
      approvals: {
        guide: {
          status: 'approved',
          comment: 'Approved by guide',
          date: new Date()
        },
        librarian: {
          status: 'failed',
          plagiarismPercentage: 25,
          report: 'High plagiarism detected',
          comment: 'Plagiarism check failed',
          date: new Date()
        }
      }
    });

    await testThesis.save();
    await testThesis.populate('scholar', 'name email scholarId');
    await testThesis.populate('guide', 'name email department');

    res.status(201).json({ 
      message: 'Test rejected thesis created successfully',
      thesis: testThesis 
    });
  } catch (error) {
    console.error('Error creating test thesis:', error);
    res.status(500).json({ message: 'Error creating test thesis', error: error.message });
  }
});

// Add this route to fix thesis status - PASTE THIS IN thesis.js
router.put('/update-thesis-status/:id', auth, async (req, res) => {
  try {
    const { newStatus, newStage } = req.body;
    const thesis = await Thesis.findById(req.params.id);
    
    if (!thesis) {
      return res.status(404).json({ message: 'Thesis not found' });
    }

    console.log('BEFORE UPDATE:');
    console.log('Status:', thesis.status);
    console.log('Stage:', thesis.currentStage);

    // Update the thesis
    if (newStatus) thesis.status = newStatus;
    if (newStage) thesis.currentStage = newStage;
    
    await thesis.save();

    console.log('AFTER UPDATE:');
    console.log('Status:', thesis.status);
    console.log('Stage:', thesis.currentStage);

    res.json({ 
      message: 'Thesis status updated successfully',
      thesis: {
        id: thesis._id,
        title: thesis.title,
        status: thesis.status,
        currentStage: thesis.currentStage
      }
    });
  } catch (error) {
    console.error('Error updating thesis:', error);
    res.status(500).json({ message: 'Error updating thesis', error: error.message });
  }
});

// NEW ROUTE 1: Get ALL theses for VC (no status filter)
router.get('/vc/all-theses', auth, async (req, res) => {
  try {
    console.log('=== VC ALL THESES REQUEST ===');
    console.log('User Role:', req.user.role);
    
    if (req.user.role !== 'vc') {
      return res.status(403).json({ message: 'Only VC can access this endpoint' });
    }

    // Get ALL theses without any status filter
    const allTheses = await Thesis.find()
      .populate('scholar', 'name email scholarId department phone')
      .populate('guide', 'name email department phone')
      .sort({ createdAt: -1 });

    console.log('VC - Total theses found:', allTheses.length);
    
    // Log status distribution for debugging
    const statusCount = {};
    allTheses.forEach(thesis => {
      statusCount[thesis.status] = (statusCount[thesis.status] || 0) + 1;
    });
    console.log('VC - Status distribution:', statusCount);

    res.json({
      total: allTheses.length,
      statusCount: statusCount,
      theses: allTheses
    });
  } catch (error) {
    console.error('Error in vc/all-theses:', error);
    res.status(500).json({ message: 'Error fetching all theses', error: error.message });
  }
});

// NEW ROUTE 2: Debug route to check all theses
router.get('/debug-all-theses', auth, async (req, res) => {
  try {
    console.log('=== DEBUG ALL THESES ===');
    
    const allTheses = await Thesis.find()
      .populate('scholar', 'name email scholarId department')
      .populate('guide', 'name email department')
      .sort({ createdAt: -1 });

    console.log('Total theses in database:', allTheses.length);
    
    const statusCount = {};
    allTheses.forEach(thesis => {
      statusCount[thesis.status] = (statusCount[thesis.status] || 0) + 1;
    });
    console.log('Status distribution:', statusCount);

    res.json({
      total: allTheses.length,
      statusCount: statusCount,
      theses: allTheses
    });
  } catch (error) {
    console.error('Error in debug-all-theses:', error);
    res.status(500).json({ message: 'Error fetching theses', error: error.message });
  }
});



module.exports = router;