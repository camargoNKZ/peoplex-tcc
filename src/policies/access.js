const REQUEST_TRANSITIONS = {
  pending: ['in_review', 'approved', 'rejected', 'cancelled'],
  in_review: ['approved', 'rejected', 'cancelled'],
  approved: [],
  rejected: [],
  cancelled: [],
};

const canTransitionRequest = (fromStatus, toStatus) =>
  (REQUEST_TRANSITIONS[fromStatus] || []).includes(toStatus);

module.exports = {
  REQUEST_TRANSITIONS,
  canTransitionRequest,
};
