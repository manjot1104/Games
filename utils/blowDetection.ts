/**
 * Blow Detection Utility
 * Detects sustained blowing by combining mouth open state and jaw protrusion
 */

export interface BlowState {
  isBlowing: boolean;
  intensity: number; // 0-1, combination of ratio and protrusion
  duration: number; // milliseconds
  isSustained: boolean; // true if blow has been sustained for threshold duration
}

export class BlowDetector {
  private blowStartTime: number | null = null;
  private isBlowing: boolean = false;
  private sustainedThreshold: number; // milliseconds (500-1000ms)
  private protrusionThreshold: number; // 0.4
  private lastIntensity: number = 0;
  private intensityHistory: number[] = []; // For smoothing
  private readonly historySize = 5;

  constructor(
    sustainedThreshold: number = 800, // 0.8 seconds
    protrusionThreshold: number = 0.25 // Decreased from 0.4 to 0.25 for easier detection
  ) {
    this.sustainedThreshold = sustainedThreshold;
    this.protrusionThreshold = protrusionThreshold;
  }

  /**
   * Update blow detection state
   * @param isOpen - Mouth is open
   * @param protrusion - Jaw protrusion (0-1)
   * @param ratio - Mouth opening ratio (0-1)
   * @param cheekExpansion - Cheek expansion (0-1), optional
   * @returns BlowState with current detection status
   */
  update(isOpen: boolean, protrusion: number, ratio: number, cheekExpansion?: number): BlowState {
    const now = Date.now();
    
    // Calculate blow intensity (combination of ratio, protrusion, and cheek expansion)
    // Normalize ratio to 0-1 range (decreased threshold from 0.05 to 0.015 for easier detection)
    // Using 0.015 means even smaller mouth openings will register
    const normalizedRatio = Math.min(1, ratio / 0.015);
    
    // Incorporate cheek expansion if available (cheeks puff out when blowing)
    const cheekFactor = cheekExpansion !== undefined ? cheekExpansion : 0;
    
    // Adjusted intensity calculation to be more sensitive to smaller openings
    // Use a more generous formula that gives credit for partial openings
    // If normalizedRatio is low but protrusion is present, still give some intensity
    // Cheek expansion is a strong indicator of blowing, so give it significant weight
    const baseIntensity = (normalizedRatio * 0.3 + protrusion * 0.4 + cheekFactor * 0.3);
    // Boost intensity if either component is present (makes it easier to fill the bar)
    const boostedIntensity = baseIntensity * 1.3; // 30% boost to make bar fill easier
    const intensity = Math.min(1, boostedIntensity);
    
    // Smooth intensity using moving average
    this.intensityHistory.push(intensity);
    if (this.intensityHistory.length > this.historySize) {
      this.intensityHistory.shift();
    }
    const smoothedIntensity = this.intensityHistory.reduce((a, b) => a + b, 0) / this.intensityHistory.length;
    this.lastIntensity = smoothedIntensity;

    // Check if conditions for blowing are met
    // Include cheek expansion as an alternative indicator (cheeks puff out when blowing)
    // Lowered cheek threshold from 0.3 to 0.15 to make it easier to detect
    const hasCheekExpansion = cheekExpansion !== undefined && cheekExpansion > 0.15;
    // Also allow lower protrusion if cheeks are expanding (more natural blowing)
    const hasAnyBlowIndicator = protrusion >= this.protrusionThreshold || hasCheekExpansion || (protrusion >= 0.15 && cheekExpansion && cheekExpansion > 0.1);
    const meetsThreshold = isOpen && hasAnyBlowIndicator;

    if (meetsThreshold && !this.isBlowing) {
      // Start of blow
      this.isBlowing = true;
      this.blowStartTime = now;
    } else if (!meetsThreshold && this.isBlowing) {
      // End of blow
      this.isBlowing = false;
      this.blowStartTime = null;
    }

    // Calculate duration
    const duration = this.blowStartTime ? now - this.blowStartTime : 0;
    const isSustained = duration >= this.sustainedThreshold;

    return {
      isBlowing: this.isBlowing,
      intensity: smoothedIntensity,
      duration,
      isSustained,
    };
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.isBlowing = false;
    this.blowStartTime = null;
    this.lastIntensity = 0;
    this.intensityHistory = [];
  }

  /**
   * Get current intensity (0-1)
   */
  getIntensity(): number {
    return this.lastIntensity;
  }
}

