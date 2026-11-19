const DEFAULT_TOLERANCE = 0.01

function validateClaims(claims, actualMetrics, tolerance = DEFAULT_TOLERANCE) {
  const results = claims.map(claim => {
    if (!Object.prototype.hasOwnProperty.call(actualMetrics, claim.metric)) {
      return {
        metric: claim.metric,
        claimedValue: claim.value,
        status: 'UNKNOWN_METRIC'
      }
    }

    const expectedValue = actualMetrics[claim.metric]
    const difference = Math.abs(expectedValue - claim.value)
    return {
      metric: claim.metric,
      claimedValue: claim.value,
      expectedValue,
      difference: Math.round(difference * 100) / 100,
      status: difference <= tolerance ? 'MATCH' : 'MISMATCH'
    }
  })

  return {
    results,
    summary: {
      total: results.length,
      matches: results.filter(result => result.status === 'MATCH').length,
      mismatches: results.filter(result => result.status === 'MISMATCH').length,
      unknownMetrics: results.filter(result => result.status === 'UNKNOWN_METRIC').length
    }
  }
}

module.exports = { validateClaims, DEFAULT_TOLERANCE }
