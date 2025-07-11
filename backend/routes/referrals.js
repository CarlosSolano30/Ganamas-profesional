const express = require('express')
const supabase = require('../config/supabase')
const { authenticateToken } = require('../middleware/auth')

const router = express.Router()

// Get user's referrals
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query

    const { data: referrals, error } = await supabase
      .from('referrals')
      .select(`
        *,
        referred_user:users!referrals_referred_id_fkey(id, name, email, tasks_completed, created_at)
      `)
      .eq('referrer_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    res.json({ referrals })

  } catch (error) {
    console.error('Get referrals error:', error)
    res.status(500).json({ error: 'Failed to fetch referrals' })
  }
})

// Get referral statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id

    // Get total referrals and earnings
    const { data: referralStats } = await supabase
      .from('referrals')
      .select('bonus_earned, tasks_completed')
      .eq('referrer_id', userId)

    const totalReferrals = referralStats?.length || 0
    const totalEarnings = referralStats?.reduce((sum, ref) => sum + ref.bonus_earned, 0) || 0
    const activeReferrals = referralStats?.filter(ref => ref.tasks_completed > 0).length || 0

    // Get referral milestones
    const milestones = [
      { tasks: 3, bonus: 5000, achieved: 0 },
      { tasks: 7, bonus: 4000, achieved: 0 },
      { tasks: 15, bonus: 8000, achieved: 0 }
    ]

    referralStats?.forEach(ref => {
      milestones.forEach(milestone => {
        if (ref.tasks_completed >= milestone.tasks) {
          milestone.achieved++
        }
      })
    })

    res.json({
      stats: {
        total_referrals: totalReferrals,
        total_earnings: totalEarnings,
        active_referrals: activeReferrals,
        milestones
      }
    })

  } catch (error) {
    console.error('Get referral stats error:', error)
    res.status(500).json({ error: 'Failed to fetch referral statistics' })
  }
})

// Generate referral link
router.get('/link', authenticateToken, async (req, res) => {
  try {
    const { referral_code } = req.user
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const referralLink = `${baseUrl}/register?ref=${referral_code}`

    res.json({
      referral_code,
      referral_link: referralLink
    })

  } catch (error) {
    console.error('Generate referral link error:', error)
    res.status(500).json({ error: 'Failed to generate referral link' })
  }
})

// Validate referral code
router.get('/validate/:code', async (req, res) => {
  try {
    const { code } = req.params

    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, referral_code')
      .eq('referral_code', code)
      .single()

    if (error || !user) {
      return res.status(404).json({ error: 'Invalid referral code' })
    }

    res.json({
      valid: true,
      referrer: {
        name: user.name,
        code: user.referral_code
      }
    })

  } catch (error) {
    console.error('Validate referral code error:', error)
    res.status(500).json({ error: 'Failed to validate referral code' })
  }
})

module.exports = router