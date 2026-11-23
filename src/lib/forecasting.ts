export type ForecastModelName =
  | 'moving_average'
  | 'exponential_smoothing'
  | 'linear_regression';

export interface DailyDemandPoint {
  date: string; // YYYY-MM-DD
  unitsSold: number;
}

export interface ModelEvaluation {
  model: ForecastModelName;
  label: string;
  mae: number;
  rmse: number;
  holdoutDays: number;
  predictedHoldout: number[];
  actualHoldout: number[];
}

export interface ForecastOutput {
  itemId: string;
  itemName: string;
  modelDate: string;
  selectedModel: ForecastModelName;
  selectedModelLabel: string;
  horizonDays: number;
  forecastedDailyDemand: number;
  forecastedTotalDemand: number;
  confidenceInterval95: { lower: number; upper: number };
  evaluations: ModelEvaluation[];
  currentEligibleStock: number;
  daysOfCoverEstimate: number | null;
  stockoutRisk: 'low' | 'moderate' | 'high';
  advisoryReorderQuantity: number;
  assumptions: string[];
  disclaimer: string;
}

export function movingAveragePredict(history: number[], windowSize = 7): number {
  if (history.length === 0) return 0;
  const slice = history.slice(-Math.min(windowSize, history.length));
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / slice.length;
}

export function exponentialSmoothingPredict(history: number[], alpha = 0.3): number {
  if (history.length === 0) return 0;
  let level = history[0];
  for (let i = 1; i < history.length; i++) {
    level = alpha * history[i] + (1 - alpha) * level;
  }
  return Math.max(0, level);
}

export function linearRegressionPredict(history: number[], stepsAhead = 1): number {
  const n = history.length;
  if (n === 0) return 0;
  if (n === 1) return Math.max(0, history[0]);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += history[i];
    sumXY += i * history[i];
    sumXX += i * i;
  }

  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const targetX = n - 1 + stepsAhead;
  return Math.max(0, intercept + slope * targetX);
}

export function computeErrorMetrics(
  actual: number[],
  predicted: number[]
): { mae: number; rmse: number } {
  if (actual.length === 0 || actual.length !== predicted.length) {
    return { mae: 0, rmse: 0 };
  }
  let absErr = 0;
  let sqErr = 0;
  for (let i = 0; i < actual.length; i++) {
    const err = actual[i] - predicted[i];
    absErr += Math.abs(err);
    sqErr += err * err;
  }
  const n = actual.length;
  return {
    mae: Math.round((absErr / n) * 100) / 100,
    rmse: Math.round(Math.sqrt(sqErr / n) * 100) / 100,
  };
}

export function evaluateHoldoutModels(
  series: number[],
  holdoutDays = 14
): ModelEvaluation[] {
  const effectiveHoldout = Math.min(holdoutDays, Math.max(1, Math.floor(series.length / 3)));
  const splitIdx = series.length - effectiveHoldout;
  const train = series.slice(0, splitIdx);
  const actualHoldout = series.slice(splitIdx);

  const models: Array<{
    model: ForecastModelName;
    label: string;
    predictStep: (hist: number[], step: number) => number;
  }> = [
    {
      model: 'moving_average',
      label: '7-Day Moving Average',
      predictStep: (hist) => movingAveragePredict(hist, 7),
    },
    {
      model: 'exponential_smoothing',
      label: 'Exponential Smoothing (α=0.30)',
      predictStep: (hist) => exponentialSmoothingPredict(hist, 0.3),
    },
    {
      model: 'linear_regression',
      label: 'OLS Linear Trend Regression',
      predictStep: (hist) => linearRegressionPredict(hist, 1),
    },
  ];

  return models.map(({ model, label, predictStep }) => {
    const predictedHoldout: number[] = [];
    const rolling = [...train];
    for (let i = 0; i < actualHoldout.length; i++) {
      const pred = Math.round(predictStep(rolling, 1) * 100) / 100;
      predictedHoldout.push(pred);
      rolling.push(actualHoldout[i]);
    }
    const { mae, rmse } = computeErrorMetrics(actualHoldout, predictedHoldout);
    return {
      model,
      label,
      mae,
      rmse,
      holdoutDays: actualHoldout.length,
      predictedHoldout,
      actualHoldout,
    };
  });
}

export function generateInventoryForecast(params: {
  itemId: string;
  itemName: string;
  history: DailyDemandPoint[];
  currentEligibleStock: number;
  minThreshold: number;
  horizonDays?: number;
  leadTimeDays?: number;
  modelDate: string;
  preferredModel?: ForecastModelName;
}): ForecastOutput {
  const horizonDays = params.horizonDays ?? 30;
  const leadTimeDays = params.leadTimeDays ?? 7;
  const series = params.history.map((d) => d.unitsSold);

  const evaluations = evaluateHoldoutModels(series, 14);
  const bestEval = [...evaluations].sort((a, b) => a.rmse - b.rmse)[0];
  const selectedModel = params.preferredModel ?? bestEval?.model ?? 'moving_average';
  const selectedEval =
    evaluations.find((e) => e.model === selectedModel) ?? bestEval;

  let dailyForecast = 0;
  if (selectedModel === 'moving_average') {
    dailyForecast = movingAveragePredict(series, 7);
  } else if (selectedModel === 'exponential_smoothing') {
    dailyForecast = exponentialSmoothingPredict(series, 0.3);
  } else {
    // Average linear regression prediction over next horizonDays
    let total = 0;
    for (let d = 1; d <= horizonDays; d++) {
      total += linearRegressionPredict(series, d);
    }
    dailyForecast = total / horizonDays;
  }

  dailyForecast = Math.round(dailyForecast * 100) / 100;
  const forecastedTotalDemand = Math.round(dailyForecast * horizonDays);
  const residualMargin = Math.max(1, (selectedEval?.rmse ?? 1) * Math.sqrt(horizonDays) * 1.2);
  const lower = Math.max(0, Math.round(forecastedTotalDemand - residualMargin));
  const upper = Math.round(forecastedTotalDemand + residualMargin);

  const daysOfCoverEstimate =
    dailyForecast > 0
      ? Math.round((params.currentEligibleStock / dailyForecast) * 10) / 10
      : null;

  let stockoutRisk: 'low' | 'moderate' | 'high' = 'low';
  if (params.currentEligibleStock <= params.minThreshold) {
    stockoutRisk = 'high';
  } else if (daysOfCoverEstimate !== null && daysOfCoverEstimate <= leadTimeDays + 5) {
    stockoutRisk = 'high';
  } else if (daysOfCoverEstimate !== null && daysOfCoverEstimate <= horizonDays) {
    stockoutRisk = 'moderate';
  }

  const safetyBuffer = Math.max(params.minThreshold, Math.round(dailyForecast * leadTimeDays));
  const targetStock = forecastedTotalDemand + safetyBuffer;
  const advisoryReorderQuantity = Math.max(0, targetStock - params.currentEligibleStock);

  return {
    itemId: params.itemId,
    itemName: params.itemName,
    modelDate: params.modelDate,
    selectedModel,
    selectedModelLabel: selectedEval?.label ?? '7-Day Moving Average',
    horizonDays,
    forecastedDailyDemand: dailyForecast,
    forecastedTotalDemand,
    confidenceInterval95: { lower, upper },
    evaluations,
    currentEligibleStock: params.currentEligibleStock,
    daysOfCoverEstimate,
    stockoutRisk,
    advisoryReorderQuantity,
    assumptions: [
      `Evaluated on trailing ${series.length} days with ${selectedEval?.holdoutDays ?? 14}-day time-based holdout split.`,
      `Only non-expired stock (${params.currentEligibleStock} units) is counted as available cover.`,
      `Safety stock policy assumes ${leadTimeDays}-day supplier lead time plus minimum threshold (${params.minThreshold} units).`,
    ],
    disclaimer:
      'Advisory estimate only. Forecasts do not account for unrecorded external outbreaks or sudden formulary changes and never trigger automatic purchase orders without pharmacist approval.',
  };
}
