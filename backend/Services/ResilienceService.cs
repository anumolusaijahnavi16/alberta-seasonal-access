using AlbertaAccess.Api.Models;

namespace AlbertaAccess.Api.Services;

public class ResilienceService
{
    public AccessAnalysisResponse Analyze(
        AccessAnalysisRequest request)
    {
        // -------------------------------------------------
        // Calculate road-network totals
        // -------------------------------------------------

        double allSeasonRoadKm =
            request.PavedRoadKm + request.GravelRoadKm;

        double totalAnalyzedRoadKm =
            allSeasonRoadKm + request.WinterRoadKm;

        // -------------------------------------------------
        // Calculate seasonal dependency
        // -------------------------------------------------

        double seasonalDependencyPercent =
            totalAnalyzedRoadKm > 0
                ? (request.WinterRoadKm /
                   totalAnalyzedRoadKm) * 100
                : 0;

        string dependencyLevel =
            seasonalDependencyPercent < 20
                ? "Low"
                : seasonalDependencyPercent < 50
                    ? "Moderate"
                    : "High";

        // -------------------------------------------------
        // Prototype Seasonal Access Resilience Indicator
        //
        // This indicator describes road-network composition
        // within the selected analysis radius.
        //
        // 100 = no analyzed winter-road dependency
        //   0 = analyzed network consists entirely of
        //       winter-road infrastructure
        //
        // IMPORTANT:
        // This is an exploratory indicator and is not an
        // official or validated Government of Alberta
        // resilience assessment.
        // -------------------------------------------------

        double resilienceScore =
            Math.Clamp(
                100 - seasonalDependencyPercent,
                0,
                100
            );

        string resilienceLevel =
            resilienceScore >= 80
                ? "High"
                : resilienceScore >= 50
                    ? "Moderate"
                    : "Low";

        // -------------------------------------------------
        // Build API response
        // -------------------------------------------------

        return new AccessAnalysisResponse
        {
            CommunityName = request.CommunityName,
            CommunityType = request.CommunityType,

            PavedRoadKm =
                Math.Round(request.PavedRoadKm, 1),

            GravelRoadKm =
                Math.Round(request.GravelRoadKm, 1),

            WinterRoadKm =
                Math.Round(request.WinterRoadKm, 1),

            AllSeasonRoadKm =
                Math.Round(allSeasonRoadKm, 1),

            TotalAnalyzedRoadKm =
                Math.Round(totalAnalyzedRoadKm, 1),

            WinterSegmentCount =
                request.WinterSegmentCount,

            AnalysisRadiusKm =
                request.AnalysisRadiusKm,

            SeasonalDependencyPercent =
                Math.Round(
                    seasonalDependencyPercent,
                    1
                ),

            DependencyLevel =
                dependencyLevel,

            ResilienceScore =
                Math.Round(resilienceScore, 1),

            ResilienceLevel =
                resilienceLevel
        };
    }
}