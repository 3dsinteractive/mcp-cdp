import crypto from 'node:crypto';
import { getDb, safeJsonParse } from '../db.js';
import { formatCustomerRow, upsertCustomer } from './customerService.js';
import { evaluateCustomerAgainstCriteria, getSegmentDetails, findMatchingCustomers } from './segmentService.js';
import { sendCampaignToCustomer } from './campaignService.js';

function genId(prefix = 'jrn') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Create or update a Customer Journey workflow
 */
export function upsertJourney({
  id,
  alias = null,
  name,
  description = '',
  status = 'active', // 'draft', 'active', 'paused', 'archived'
  trigger_type = 'segment', // 'segment', 'event', 'behavior'
  trigger_config = {},
  steps = [],
  goal_config = {}
}) {
  const db = getDb();
  const journeyId = id || genId('jrn');
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM journeys WHERE id = ?').get(journeyId);
  if (existing) {
    db.prepare(`
      UPDATE journeys
      SET alias = ?, name = ?, description = ?, status = ?, trigger_type = ?,
          trigger_config = ?, steps = ?, goal_config = ?, updated_at = ?
      WHERE id = ?
    `).run(
      alias ?? existing.alias,
      name ?? existing.name,
      description ?? existing.description,
      status ?? existing.status,
      trigger_type ?? existing.trigger_type,
      JSON.stringify(trigger_config),
      JSON.stringify(steps),
      JSON.stringify(goal_config),
      now,
      journeyId
    );
  } else {
    db.prepare(`
      INSERT INTO journeys (
        id, alias, name, description, status, trigger_type, trigger_config, steps, goal_config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      journeyId,
      alias,
      name,
      description,
      status,
      trigger_type,
      JSON.stringify(trigger_config),
      JSON.stringify(steps),
      JSON.stringify(goal_config),
      now,
      now
    );
  }

  return getJourneyPerformance(journeyId);
}

/**
 * Execute steps for an enrolled customer starting from their current_step_id
 */
export function processEnrollmentSteps(enrollmentId, { advance_waiting = true } = {}) {
  const db = getDb();
  let enrollment = db.prepare('SELECT * FROM journey_enrollments WHERE id = ?').get(enrollmentId);
  if (!enrollment) throw new Error(`Enrollment '${enrollmentId}' not found`);

  const journey = db.prepare('SELECT * FROM journeys WHERE id = ?').get(enrollment.journey_id);
  const steps = safeJsonParse(journey.steps, []);
  const goalConfig = safeJsonParse(journey.goal_config, {});
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  let currentStepId = enrollment.current_step_id || (steps[0] ? steps[0].id : null);
  let safetyCounter = 0;
  const executedSteps = [];

  while (currentStepId && safetyCounter < 25) {
    safetyCounter++;
    const step = stepMap.get(currentStepId);
    if (!step) {
      break;
    }

    const customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(enrollment.customer_id);
    if (!customerRow) break;
    const customer = formatCustomerRow(customerRow);
    const now = new Date().toISOString();

    let resultStatus = 'success';
    let actionTaken = '';
    let details = {};
    let nextStepId = step.next_step_id || null;

    if (step.type === 'send_campaign') {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(step.campaign_id);
      if (!campaign) {
        resultStatus = 'failed';
        actionTaken = `Campaign '${step.campaign_id}' not found`;
      } else {
        const sendRes = sendCampaignToCustomer({
          campaign,
          customer,
          journey_id: journey.id,
          journey_step_id: step.id
        });
        resultStatus = sendRes.status === 'delivered' ? 'success' : sendRes.status;
        actionTaken = `Sent campaign '${campaign.name}' via ${campaign.channel} (${sendRes.status})`;
        details = sendRes;
      }
    } else if (step.type === 'condition_split' || step.type === 'condition') {
      // Evaluate condition criteria using Segment evaluation engine
      const conditionCriteria = step.criteria || {};
      const matched = evaluateCustomerAgainstCriteria(customer, conditionCriteria, db);
      resultStatus = matched ? 'branched_yes' : 'branched_no';
      actionTaken = `Evaluated condition '${step.name || step.id}': ${matched ? 'TRUE (Yes branch)' : 'FALSE (No branch)'}`;
      nextStepId = matched ? (step.on_true_step_id ?? null) : (step.on_false_step_id ?? null);
      details = { matched, branch_taken: matched ? 'yes' : 'no', next_step_id: nextStepId };
    } else if (step.type === 'wait') {
      const waitDesc = step.wait_days
        ? `${step.wait_days} days`
        : step.wait_hours
          ? `${step.wait_hours} hours`
          : step.wait_for_event
            ? `event ${step.wait_for_event}`
            : 'configured duration';

      if (!advance_waiting && enrollment.status !== 'waiting') {
        // Pause at this wait step until resumed
        resultStatus = 'waiting';
        actionTaken = `Paused waiting for ${waitDesc}`;
        details = { wait_days: step.wait_days, wait_hours: step.wait_hours, next_step_id: step.next_step_id };

        db.prepare(`
          INSERT INTO journey_step_logs (
            id, enrollment_id, journey_id, customer_id, step_id, step_type, action_taken, result_status, details, executed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          genId('jsl'),
          enrollment.id,
          journey.id,
          customer.id,
          step.id,
          step.type,
          actionTaken,
          resultStatus,
          JSON.stringify(details),
          now
        );

        db.prepare(`
          UPDATE journey_enrollments
          SET current_step_id = ?, status = 'waiting', updated_at = ?
          WHERE id = ?
        `).run(step.next_step_id || null, now, enrollment.id);

        executedSteps.push({ step_id: step.id, type: step.type, result_status: resultStatus, action_taken: actionTaken });
        return {
          enrollment_id: enrollment.id,
          customer_id: customer.id,
          status: 'waiting',
          executed_steps: executedSteps
        };
      }

      resultStatus = 'success';
      actionTaken = `Completed wait step (${waitDesc})`;
      details = { wait_completed: true };
    } else if (step.type === 'update_profile') {
      const updates = { id: customer.id };
      if (step.add_tags) updates.tags = step.add_tags;
      if (step.set_tier) updates.tier = step.set_tier;
      if (step.set_lifecycle_stage) updates.lifecycle_stage = step.set_lifecycle_stage;
      if (step.custom_attributes) updates.custom_attributes = step.custom_attributes;
      upsertCustomer(updates);
      resultStatus = 'success';
      actionTaken = `Updated profile attributes/tags for customer`;
      details = updates;
    } else if (step.type === 'goal_check') {
      const goalCriteria = step.criteria || goalConfig.criteria || {};
      const achieved = evaluateCustomerAgainstCriteria(customer, goalCriteria, db);
      resultStatus = achieved ? 'branched_yes' : 'branched_no';
      actionTaken = achieved ? 'Customer achieved journey conversion goal!' : 'Customer has not achieved goal yet';
      details = { goal_achieved: achieved };
      if (achieved) {
        db.prepare(`
          UPDATE journey_enrollments
          SET status = 'converted', converted_at = ?, completed_at = ?, conversion_value = ?, updated_at = ?
          WHERE id = ?
        `).run(now, now, Number(step.conversion_value || goalConfig.default_value || customer.total_spent || 0), now, enrollment.id);
      }
    }

    db.prepare(`
      INSERT INTO journey_step_logs (
        id, enrollment_id, journey_id, customer_id, step_id, step_type, action_taken, result_status, details, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      genId('jsl'),
      enrollment.id,
      journey.id,
      customer.id,
      step.id,
      step.type,
      actionTaken,
      resultStatus,
      JSON.stringify(details),
      now
    );

    executedSteps.push({
      step_id: step.id,
      step_name: step.name || step.id,
      type: step.type,
      result_status: resultStatus,
      action_taken: actionTaken,
      next_step_id: nextStepId
    });

    currentStepId = nextStepId;
  }

  const now = new Date().toISOString();
  // Check if goal_config is met at the end of the journey
  const finalCustomer = formatCustomerRow(db.prepare('SELECT * FROM customers WHERE id = ?').get(enrollment.customer_id));
  let finalStatus = 'completed';
  let convertedAt = enrollment.converted_at;
  let conversionValue = enrollment.conversion_value || 0;

  if (goalConfig && goalConfig.criteria && Object.keys(goalConfig.criteria).length > 0) {
    const goalMet = evaluateCustomerAgainstCriteria(finalCustomer, goalConfig.criteria, db);
    if (goalMet) {
      finalStatus = 'converted';
      convertedAt = now;
      conversionValue = Number(goalConfig.conversion_value || finalCustomer.total_spent || 0);
    }
  } else {
    const check = db.prepare('SELECT status, converted_at, conversion_value FROM journey_enrollments WHERE id = ?').get(enrollment.id);
    if (check.status === 'converted') {
      finalStatus = 'converted';
      convertedAt = check.converted_at;
      conversionValue = check.conversion_value;
    }
  }

  db.prepare(`
    UPDATE journey_enrollments
    SET current_step_id = NULL, status = ?, completed_at = ?, converted_at = ?, conversion_value = ?, updated_at = ?
    WHERE id = ?
  `).run(finalStatus, now, convertedAt, conversionValue, now, enrollment.id);

  return {
    enrollment_id: enrollment.id,
    customer_id: enrollment.customer_id,
    status: finalStatus,
    converted_at: convertedAt,
    conversion_value: conversionValue,
    executed_steps: executedSteps
  };
}

/**
 * Trigger / Run a Journey for matching customers (by Segment, Event, Behavior, or explicit customer_ids)
 */
export function runJourney({
  journey_id,
  customer_ids = null,
  advance_waiting = true,
  re_enroll = false
}) {
  const db = getDb();
  const journey = db.prepare('SELECT * FROM journeys WHERE id = ?').get(journey_id);
  if (!journey) {
    throw new Error(`Journey '${journey_id}' not found`);
  }

  const triggerConfig = safeJsonParse(journey.trigger_config, {});
  const steps = safeJsonParse(journey.steps, []);
  let targetCustomers = [];

  if (Array.isArray(customer_ids) && customer_ids.length > 0) {
    const placeholders = customer_ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM customers WHERE id IN (${placeholders})`).all(...customer_ids);
    targetCustomers = rows.map(formatCustomerRow);
  } else if (journey.trigger_type === 'segment' && triggerConfig.segment_id) {
    const segDetails = getSegmentDetails(triggerConfig.segment_id);
    targetCustomers = segDetails.members;
  } else if (journey.trigger_type === 'event' && triggerConfig.event_name) {
    const criteria = {
      event_conditions: [
        {
          event_name: triggerConfig.event_name,
          min_count: triggerConfig.min_count || 1,
          within_days: triggerConfig.within_days,
          property_filters: triggerConfig.property_filters
        }
      ]
    };
    targetCustomers = findMatchingCustomers(criteria);
  } else if (journey.trigger_type === 'behavior' && triggerConfig.criteria) {
    targetCustomers = findMatchingCustomers(triggerConfig.criteria);
  } else {
    targetCustomers = findMatchingCustomers(triggerConfig);
  }

  const firstStepId = steps[0] ? steps[0].id : null;
  const now = new Date().toISOString();
  const results = [];

  for (const customer of targetCustomers) {
    let existing = db.prepare(`
      SELECT * FROM journey_enrollments WHERE journey_id = ? AND customer_id = ? ORDER BY enrolled_at DESC LIMIT 1
    `).get(journey_id, customer.id);

    if (existing && existing.status === 'waiting' && advance_waiting) {
      const res = processEnrollmentSteps(existing.id, { advance_waiting: true });
      results.push(res);
      continue;
    }

    if (existing && !re_enroll) {
      results.push({
        enrollment_id: existing.id,
        customer_id: customer.id,
        status: 'already_enrolled',
        current_status: existing.status
      });
      continue;
    }

    const enrollmentId = genId('enr');
    db.prepare(`
      INSERT INTO journey_enrollments (
        id, journey_id, customer_id, current_step_id, status, enrolled_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(enrollmentId, journey_id, customer.id, firstStepId, now, now);

    const execRes = processEnrollmentSteps(enrollmentId, { advance_waiting });
    results.push(execRes);
  }

  return {
    journey_id,
    journey_name: journey.name,
    trigger_type: journey.trigger_type,
    matched_customers_count: targetCustomers.length,
    processed_results: results,
    performance_summary: getJourneyPerformance(journey_id).summary
  };
}

/**
 * Get Journey configuration, step-by-step funnel performance, campaign stats, and enrollment results
 */
export function getJourneyPerformance(journey_id) {
  const db = getDb();
  const journey = db.prepare('SELECT * FROM journeys WHERE id = ?').get(journey_id);
  if (!journey) {
    throw new Error(`Journey '${journey_id}' not found`);
  }

  const steps = safeJsonParse(journey.steps, []);
  const triggerConfig = safeJsonParse(journey.trigger_config, {});
  const goalConfig = safeJsonParse(journey.goal_config, {});

  const enrollStats = db.prepare(`
    SELECT
      COUNT(*) as total_enrolled,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
      SUM(CASE WHEN status IN ('completed', 'converted') THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted,
      SUM(conversion_value) as total_conversion_value
    FROM journey_enrollments
    WHERE journey_id = ?
  `).get(journey_id);

  const stepFunnel = steps.map((step) => {
    const sRow = db.prepare(`
      SELECT
        COUNT(*) as executions,
        COUNT(DISTINCT customer_id) as unique_customers,
        SUM(CASE WHEN result_status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN result_status = 'branched_yes' THEN 1 ELSE 0 END) as branched_yes_count,
        SUM(CASE WHEN result_status = 'branched_no' THEN 1 ELSE 0 END) as branched_no_count,
        SUM(CASE WHEN result_status = 'waiting' THEN 1 ELSE 0 END) as waiting_count,
        SUM(CASE WHEN result_status IN ('failed', 'skipped_no_consent') THEN 1 ELSE 0 END) as failed_or_skipped_count
      FROM journey_step_logs
      WHERE journey_id = ? AND step_id = ?
    `).get(journey_id, step.id);

    return {
      step_id: step.id,
      step_name: step.name || step.id,
      step_type: step.type,
      campaign_id: step.campaign_id || null,
      next_step_id: step.next_step_id || null,
      on_true_step_id: step.on_true_step_id || null,
      on_false_step_id: step.on_false_step_id || null,
      metrics: {
        executions: sRow.executions || 0,
        unique_customers: sRow.unique_customers || 0,
        success_count: sRow.success_count || 0,
        branched_yes_count: sRow.branched_yes_count || 0,
        branched_no_count: sRow.branched_no_count || 0,
        waiting_count: sRow.waiting_count || 0,
        failed_or_skipped_count: sRow.failed_or_skipped_count || 0
      }
    };
  });

  const campaignBreakdown = db.prepare(`
    SELECT
      cl.campaign_id,
      c.name as campaign_name,
      cl.channel,
      COUNT(*) as total_sent,
      SUM(CASE WHEN cl.status IN ('delivered', 'opened', 'clicked', 'converted') THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN cl.status IN ('opened', 'clicked', 'converted') OR cl.opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN cl.status IN ('clicked', 'converted') OR cl.clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN cl.status = 'converted' OR cl.converted_at IS NOT NULL THEN 1 ELSE 0 END) as converted
    FROM campaign_logs cl
    LEFT JOIN campaigns c ON cl.campaign_id = c.id
    WHERE cl.journey_id = ?
    GROUP BY cl.campaign_id, cl.channel
  `).all(journey_id);

  const recentEnrollments = db.prepare(`
    SELECT je.*, c.first_name, c.last_name, c.email, c.tier
    FROM journey_enrollments je
    JOIN customers c ON je.customer_id = c.id
    WHERE je.journey_id = ?
    ORDER BY je.enrolled_at DESC LIMIT 25
  `).all(journey_id);

  const totalEnrolled = enrollStats.total_enrolled || 0;
  const converted = enrollStats.converted || 0;

  return {
    id: journey.id,
    alias: journey.alias,
    name: journey.name,
    description: journey.description,
    status: journey.status,
    trigger_type: journey.trigger_type,
    trigger_config: triggerConfig,
    goal_config: goalConfig,
    summary: {
      total_enrolled: totalEnrolled,
      active: enrollStats.active || 0,
      waiting: enrollStats.waiting || 0,
      completed: enrollStats.completed || 0,
      converted,
      conversion_rate_percent: totalEnrolled > 0 ? Number(((converted / totalEnrolled) * 100).toFixed(1)) : 0,
      total_conversion_revenue: Number((enrollStats.total_conversion_value || 0).toFixed(2))
    },
    step_funnel: stepFunnel,
    campaign_performance_in_journey: campaignBreakdown,
    enrollments: recentEnrollments
  };
}

export function listJourneys() {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM journeys ORDER BY created_at DESC').all();
  return {
    total: rows.length,
    journeys: rows.map((r) => getJourneyPerformance(r.id))
  };
}
