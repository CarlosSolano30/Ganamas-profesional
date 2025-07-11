const express = require('express')
const supabase = require('../config/supabase')
const { authenticateToken } = require('../middleware/auth')

const router = express.Router()

// Get available tasks
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { provider, limit = 20, offset = 0 } = req.query

    let query = supabase
      .from('tasks')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (provider) {
      query = query.eq('provider', provider)
    }

    const { data: tasks, error } = await query

    if (error) {
      throw error
    }

    res.json({ tasks })

  } catch (error) {
    console.error('Get tasks error:', error)
    res.status(500).json({ error: 'Failed to fetch tasks' })
  }
})

// Get user's completed tasks
router.get('/completed', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query

    const { data: userTasks, error } = await supabase
      .from('user_tasks')
      .select(`
        *,
        task:tasks(title, description, provider)
      `)
      .eq('user_id', req.user.id)
      .order('completed_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    res.json({ tasks: userTasks })

  } catch (error) {
    console.error('Get completed tasks error:', error)
    res.status(500).json({ error: 'Failed to fetch completed tasks' })
  }
})

// Complete a task
router.post('/:taskId/complete', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params
    const userId = req.user.id

    // Check if task exists and is active
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('status', 'active')
      .single()

    if (taskError || !task) {
      return res.status(404).json({ error: 'Task not found or inactive' })
    }

    // Check if user already completed this task
    const { data: existingUserTask } = await supabase
      .from('user_tasks')
      .select('id')
      .eq('user_id', userId)
      .eq('task_id', taskId)
      .single()

    if (existingUserTask) {
      return res.status(400).json({ error: 'Task already completed' })
    }

    // Create user task record
    const { data: userTask, error: userTaskError } = await supabase
      .from('user_tasks')
      .insert({
        user_id: userId,
        task_id: taskId,
        status: 'completed',
        reward_amount: task.reward,
        completed_at: new Date().toISOString()
      })
      .select()
      .single()

    if (userTaskError) {
      throw userTaskError
    }

    // Update user balance and task count
    await supabase
      .from('users')
      .update({
        balance: supabase.sql`balance + ${task.reward}`,
        total_earnings: supabase.sql`total_earnings + ${task.reward}`,
        tasks_completed: supabase.sql`tasks_completed + 1`,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    // Check for referral bonuses
    await checkReferralBonuses(userId)

    res.json({
      message: 'Task completed successfully',
      reward: task.reward,
      userTask
    })

  } catch (error) {
    console.error('Complete task error:', error)
    res.status(500).json({ error: 'Failed to complete task' })
  }
})

// Function to check and apply referral bonuses
async function checkReferralBonuses(userId) {
  try {
    // Get user's referrer
    const { data: user } = await supabase
      .from('users')
      .select('referred_by, tasks_completed')
      .eq('id', userId)
      .single()

    if (!user?.referred_by) return

    const referrerId = user.referred_by
    const tasksCompleted = user.tasks_completed

    // Get referral record
    const { data: referral } = await supabase
      .from('referrals')
      .select('*')
      .eq('referrer_id', referrerId)
      .eq('referred_id', userId)
      .single()

    if (!referral) return

    let bonusAmount = 0
    let bonusDescription = ''

    // Check for bonus milestones (updated bonuses)
    if (tasksCompleted === 3 && referral.tasks_completed < 3) {
      bonusAmount = 5000
      bonusDescription = 'Bono por 3 tareas completadas del referido'
    } else if (tasksCompleted === 7 && referral.tasks_completed < 7) {
      bonusAmount = 4000
      bonusDescription = 'Bono adicional por 7 tareas completadas del referido'
    } else if (tasksCompleted === 15 && referral.tasks_completed < 15) {
      bonusAmount = 8000
      bonusDescription = 'Bono extra por 15 tareas completadas del referido'
    }

    if (bonusAmount > 0) {
      // Update referrer's balance
      await supabase
        .from('users')
        .update({
          balance: supabase.sql`balance + ${bonusAmount}`,
          total_earnings: supabase.sql`total_earnings + ${bonusAmount}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', referrerId)

      // Update referral record
      await supabase
        .from('referrals')
        .update({
          bonus_earned: supabase.sql`bonus_earned + ${bonusAmount}`,
          tasks_completed: tasksCompleted
        })
        .eq('id', referral.id)

      // Create notification for referrer
      await supabase
        .from('notifications')
        .insert({
          user_id: referrerId,
          title: '¡Nuevo bono de referido!',
          message: `Has ganado COP ${bonusAmount.toLocaleString()} por las tareas completadas de tu referido.`,
          type: 'success'
        })
    } else {
      // Just update task count
      await supabase
        .from('referrals')
        .update({ tasks_completed: tasksCompleted })
        .eq('id', referral.id)
    }

  } catch (error) {
    console.error('Referral bonus check error:', error)
  }
}

// Get task providers
router.get('/providers', authenticateToken, async (req, res) => {
  try {
    const providers = [
      {
        id: 'adgem',
        name: 'AdGem',
        description: 'Completa ofertas y gana recompensas',
        logo: '🎯',
        active: true
      },
      {
        id: 'ayet',
        name: 'Ayet Studios',
        description: 'Juegos y aplicaciones móviles',
        logo: '🎮',
        active: true
      },
      {
        id: 'cpx',
        name: 'CPX Research',
        description: 'Encuestas y estudios de mercado',
        logo: '📊',
        active: true
      }
    ]

    // Get task counts for each provider
    for (let provider of providers) {
      const { count } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('provider', provider.id)
        .eq('status', 'active')

      provider.task_count = count || 0
    }

    res.json({ providers })

  } catch (error) {
    console.error('Get providers error:', error)
    res.status(500).json({ error: 'Failed to fetch providers' })
  }
})

module.exports = router