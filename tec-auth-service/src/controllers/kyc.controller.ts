import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { prisma } from '../config/database';

// GET /kyc/status - Get KYC verification status
export const getKycStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    const kycData = await prisma.kycData.findUnique({
      where: { user_id: userId },
    });

    res.json({
      success: true,
      data: {
        kyc: kycData || { status: 'NONE' },
      },
    });
  } catch (error) {
    console.error('Get KYC status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve KYC status',
      },
    });
  }
};

// POST /kyc/submit - Submit KYC verification data
export const submitKyc = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const userId = (req as any).user?.id;
    const { fullName, dateOfBirth, country, documentType, documentId } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    // Check if KYC already exists
    const existing = await prisma.kycData.findUnique({
      where: { user_id: userId },
    });

    if (existing && existing.status === 'VERIFIED') {
      res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'KYC already verified for this user',
        },
      });
      return;
    }

    const kycData = await prisma.kycData.upsert({
      where: { user_id: userId },
      update: {
        full_name: fullName,
        date_of_birth: new Date(dateOfBirth),
        country,
        document_type: documentType,
        document_id: documentId,
        status: 'PENDING',
        submitted_at: new Date(),
      },
      create: {
        user_id: userId,
        full_name: fullName,
        date_of_birth: new Date(dateOfBirth),
        country,
        document_type: documentType,
        document_id: documentId,
        status: 'PENDING',
      },
    });

    // Update user's KYC status
    await prisma.user.update({
      where: { id: userId },
      data: { kyc_status: 'pending' },
    });

    res.status(201).json({
      success: true,
      data: {
        kyc: kycData,
        message: 'KYC data submitted successfully for review',
      },
    });
  } catch (error) {
    console.error('Submit KYC error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to submit KYC data',
      },
    });
  }
};

// POST /kyc/verify - Verify KYC (admin only)
export const verifyKyc = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const currentUser = (req as any).user;
    const { userId, approved, rejectionNote } = req.body;

    // Check if user is admin
    if (!currentUser || currentUser.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only administrators can verify KYC',
        },
      });
      return;
    }

    const kycData = await prisma.kycData.findUnique({
      where: { user_id: userId },
    });

    if (!kycData) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'KYC data not found for this user',
        },
      });
      return;
    }

    const newStatus = approved ? 'VERIFIED' : 'REJECTED';

    const updated = await prisma.kycData.update({
      where: { user_id: userId },
      data: {
        status: newStatus,
        verified_at: approved ? new Date() : null,
        rejection_note: approved ? null : rejectionNote,
      },
    });

    // Update user's KYC status
    await prisma.user.update({
      where: { id: userId },
      data: { kyc_status: approved ? 'verified' : 'rejected' },
    });

    res.json({
      success: true,
      data: {
        kyc: updated,
        message: `KYC ${approved ? 'verified' : 'rejected'} successfully`,
      },
    });
  } catch (error) {
    console.error('Verify KYC error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to verify KYC',
      },
    });
  }
};