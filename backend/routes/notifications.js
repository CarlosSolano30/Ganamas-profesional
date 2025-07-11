const express = require('express')
const supabase = require('../config/supabase')
const { authenticateToken } = require('../middleware/auth')

const router = express.Router()

// Get user notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0, unread_only = false } = req.query

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (unread_only === 'true') {
      query = query.eq('read', false)
    }

    const { data: notifications, error } = await query

    if (error) {
      throw error
    }

    res.json({ notifications })

  } catch (error) {
    console.error('Get notifications error:', error)
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// Mark notification as read
router.put('/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params

    const { data: notification, error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', req.user.id)
      .select()
      .single()

    if (error) {
      throw error
    }

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    res.json({
      message: 'Notification marked as read',
      notification
    })

  } catch (error) {
    console.error('Mark notification read error:', error)
    res.status(500).json({ error: 'Failed to mark notification as read' })
  }
})

// Mark all notifications as read
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', req.user.id)
      .eq('read', false)

    if (error) {
      throw error
    }

    res.json({ message: 'All notifications marked as read' })

  } catch (error) {
    console.error('Mark all notifications read error:', error)
    res.status(500).json({ error: 'Failed to mark all notifications as read' })
  }
})

// Get unread notification count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('read', false)

    if (error) {
      throw error
    }

    res.json({ unread_count: count || 0 })

  } catch (error) {
    console.error('Get unread count error:', error)
    res.status(500).json({ error: 'Failed to fetch unread count' })
  }
})

// Create notification (internal use)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, message, type = 'info' } = req.body

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' })
    }

    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        user_id: req.user.id,
        title,
        message,
        type,
        read: false
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    res.status(201).json({
      message: 'Notification created successfully',
      notification
    })

  } catch (error) {
    console.error('Create notification error:', error)
    res.status(500).json({ error: 'Failed to create notification' })
  }
})

// Delete notification
router.delete('/:notificationId', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params

    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', req.user.id)

    if (error) {
      throw error
    }

    res.json({ message: 'Notification deleted successfully' })

  } catch (error) {
    console.error('Delete notification error:', error)
    res.status(500).json({ error: 'Failed to delete notification' })
  }
})

module.exports = router