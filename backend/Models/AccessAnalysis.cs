namespace AlbertaAccess.Api.Models;

public class AccessAnalysisRequest
{
    public string CommunityName { get; set; } = string.Empty;

    public string CommunityType { get; set; } = string.Empty;

    public double PavedRoadKm { get; set; }

    public double GravelRoadKm { get; set; }

    public double WinterRoadKm { get; set; }

    public int WinterSegmentCount { get; set; }

    public double AnalysisRadiusKm { get; set; } = 50;
}

public class AccessAnalysisResponse
{
    public string CommunityName { get; set; } = string.Empty;

    public string CommunityType { get; set; } = string.Empty;

    public double PavedRoadKm { get; set; }

    public double GravelRoadKm { get; set; }

    public double WinterRoadKm { get; set; }

    public double AllSeasonRoadKm { get; set; }

    public double TotalAnalyzedRoadKm { get; set; }

    public int WinterSegmentCount { get; set; }

    public double AnalysisRadiusKm { get; set; }

    public double SeasonalDependencyPercent { get; set; }

    public string DependencyLevel { get; set; } = string.Empty;

    public double ResilienceScore { get; set; }

    public string ResilienceLevel { get; set; } = string.Empty;
}