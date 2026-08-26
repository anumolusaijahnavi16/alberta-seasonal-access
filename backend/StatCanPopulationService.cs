using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AlbertaAccess.Api.Services;

public sealed class StatCanPopulationService
{
    private const string DownloadApi =
        "https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/98100004/en";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SemaphoreSlim _loadLock = new(1, 1);

    private Dictionary<string, PopulationRecord>? _albertaByName;

    public StatCanPopulationService(IHttpClientFactory httpClientFactory)
    {
        _httpClientFactory = httpClientFactory;
    }

    public async Task<PopulationRecord?> FindAlbertaCommunityAsync(
        string communityName)
    {
        await EnsureLoadedAsync();

        if (_albertaByName is null)
        {
            return null;
        }

        var key = NormalizeName(communityName);

        return _albertaByName.TryGetValue(key, out var record)
            ? record
            : null;
    }

    private async Task EnsureLoadedAsync()
    {
        if (_albertaByName is not null)
        {
            return;
        }

        await _loadLock.WaitAsync();

        try
        {
            if (_albertaByName is not null)
            {
                return;
            }

            _albertaByName = await DownloadAndParseAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine(
                $"Statistics Canada population dataset load failed: {ex.Message}"
            );

            _albertaByName = new Dictionary<string, PopulationRecord>(
                StringComparer.OrdinalIgnoreCase
            );
        }
        finally
        {
            _loadLock.Release();
        }
    }

    private async Task<Dictionary<string, PopulationRecord>>
        DownloadAndParseAsync()
    {
        var httpClient = _httpClientFactory.CreateClient();

        using var apiResponse = await httpClient.GetAsync(DownloadApi);
        apiResponse.EnsureSuccessStatusCode();

        var apiJson = await apiResponse.Content.ReadAsStringAsync();
        using var apiDocument = JsonDocument.Parse(apiJson);

        if (
            !apiDocument.RootElement.TryGetProperty("status", out var status) ||
            !string.Equals(
                status.GetString(),
                "SUCCESS",
                StringComparison.OrdinalIgnoreCase
            ) ||
            !apiDocument.RootElement.TryGetProperty(
                "object",
                out var downloadObject
            )
        )
        {
            throw new InvalidOperationException(
                "Statistics Canada did not return a full-table download URL."
            );
        }

        var zipUrl = downloadObject.GetString();

        if (string.IsNullOrWhiteSpace(zipUrl))
        {
            throw new InvalidOperationException(
                "Statistics Canada download URL was empty."
            );
        }

        using var zipResponse = await httpClient.GetAsync(zipUrl);
        zipResponse.EnsureSuccessStatusCode();

        await using var zipStream =
            await zipResponse.Content.ReadAsStreamAsync();

        using var archive = new ZipArchive(
            zipStream,
            ZipArchiveMode.Read,
            leaveOpen: false
        );

        var csvEntry = archive.Entries.FirstOrDefault(entry =>
            entry.Name.Equals(
                "98100004.csv",
                StringComparison.OrdinalIgnoreCase
            )
        ) ?? archive.Entries.FirstOrDefault(entry =>
            entry.Name.EndsWith(
                ".csv",
                StringComparison.OrdinalIgnoreCase
            ) &&
            !entry.Name.Contains(
                "Metadata",
                StringComparison.OrdinalIgnoreCase
            )
        );

        if (csvEntry is null)
        {
            throw new InvalidOperationException(
                "Statistics Canada population CSV was not found in the ZIP."
            );
        }

        await using var csvStream = csvEntry.Open();
        using var reader = new StreamReader(
            csvStream,
            Encoding.UTF8,
            detectEncodingFromByteOrderMarks: true
        );

        var headerLine = await reader.ReadLineAsync();

        if (headerLine is null)
        {
            throw new InvalidOperationException(
                "Statistics Canada population CSV was empty."
            );
        }

        var headers = ParseCsvLine(headerLine);

        // The full Census cube is a WIDE CSV. Its real columns include:
        // GEO, DGUID, Coordinate,
        // Population and dwelling counts (7): Population, 2021 [1], ...
        var geoIndex = FindHeader(
            headers,
            value => value.Equals(
                "GEO",
                StringComparison.OrdinalIgnoreCase
            )
        );

        var dguidIndex = FindHeader(
            headers,
            value => value.Equals(
                "DGUID",
                StringComparison.OrdinalIgnoreCase
            )
        );

        var populationIndex = FindHeader(
            headers,
            value =>
                value.Contains(
                    "Population and dwelling counts",
                    StringComparison.OrdinalIgnoreCase
                ) &&
                value.Contains(
                    "Population, 2021",
                    StringComparison.OrdinalIgnoreCase
                ) &&
                !value.Contains(
                    "percentage",
                    StringComparison.OrdinalIgnoreCase
                )
        );

        if (geoIndex < 0 || dguidIndex < 0 || populationIndex < 0)
        {
            Console.WriteLine(
                "StatCan CSV headers: " +
                string.Join(" | ", headers.Take(12))
            );

            throw new InvalidOperationException(
                "Statistics Canada CSV columns still do not match the expected wide Census table."
            );
        }

        var results = new Dictionary<string, PopulationRecord>(
            StringComparer.OrdinalIgnoreCase
        );

        string? line;

        // Do not use EndOfStream in an async loop (removes CA2024).
        while ((line = await reader.ReadLineAsync()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var values = ParseCsvLine(line);

            var requiredMax = new[]
            {
                geoIndex,
                dguidIndex,
                populationIndex
            }.Max();

            if (values.Count <= requiredMax)
            {
                continue;
            }

            var dguid = values[dguidIndex].Trim();

            // Table 98-10-0004 contains several geography levels.
            // We only want Alberta:
            // 2021A0005... = Census subdivision
            // 2021A0006... = Designated place
            // and Alberta's province code is 48.
            if (!IsAlbertaCommunityDguid(dguid))
            {
                continue;
            }

            var rawGeo = values[geoIndex].Trim();

            if (string.IsNullOrWhiteSpace(rawGeo))
            {
                continue;
            }

            var populationText = values[populationIndex]
                .Replace(",", "")
                .Trim();

            if (!int.TryParse(
                    populationText,
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out var population))
            {
                continue;
            }

            var (communityName, geography) =
                ParseGeography(rawGeo, dguid);

            if (string.IsNullOrWhiteSpace(communityName))
            {
                continue;
            }

            var key = NormalizeName(communityName);

            var record = new PopulationRecord(
                communityName,
                population,
                2021,
                geography,
                "Statistics Canada — 2021 Census"
            );

            // If the same name exists as both a municipality and a
            // designated place, prefer the DPL because the Alberta map
            // is primarily Hamlet / Locality / Townsite.
            if (!results.TryGetValue(key, out var existing))
            {
                results[key] = record;
            }
            else if (
                IsDesignatedPlaceDguid(dguid) &&
                !existing.Geography.Contains(
                    "Designated",
                    StringComparison.OrdinalIgnoreCase
                )
            )
            {
                results[key] = record;
            }
        }

        Console.WriteLine(
            $"Loaded {results.Count:N0} Alberta Census community population records."
        );

        return results;
    }

    private static bool IsAlbertaCommunityDguid(string dguid)
    {
        if (string.IsNullOrWhiteSpace(dguid))
        {
            return false;
        }

        // Examples:
        // CSD: 2021A0005 + 48 + ...
        // DPL: 2021A0006 + 48 + ...
        return Regex.IsMatch(
            dguid,
            @"^2021A000[56]48",
            RegexOptions.IgnoreCase
        );
    }

    private static bool IsDesignatedPlaceDguid(string dguid)
    {
        return dguid.StartsWith(
            "2021A000648",
            StringComparison.OrdinalIgnoreCase
        );
    }

    private static (string Name, string Geography) ParseGeography(
        string rawGeo,
        string dguid)
    {
        // GEO is commonly formatted with a type after a comma.
        // Keep only the actual place name for matching.
        var parts = rawGeo
            .Split(',', StringSplitOptions.TrimEntries)
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .ToArray();

        var name = parts.Length > 0 ? parts[0] : rawGeo;

        // Remove occasional footnote markers if they appear in exports.
        name = Regex.Replace(name, @"\s*\^\{?\d+\}?\s*$", "");
        name = name.Trim();

        if (IsDesignatedPlaceDguid(dguid))
        {
            var type = parts.Length > 1
                ? parts[1]
                : "Designated place";

            return (name, $"Designated place · {type}");
        }

        var csdType = parts.Length > 1
            ? parts[1]
            : "Census subdivision";

        return (name, csdType);
    }

    private static int FindHeader(
        IReadOnlyList<string> headers,
        Func<string, bool> predicate)
    {
        for (var index = 0; index < headers.Count; index++)
        {
            if (predicate(headers[index].Trim()))
            {
                return index;
            }
        }

        return -1;
    }

    private static List<string> ParseCsvLine(string line)
    {
        var values = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (var index = 0; index < line.Length; index++)
        {
            var character = line[index];

            if (character == '"')
            {
                if (
                    inQuotes &&
                    index + 1 < line.Length &&
                    line[index + 1] == '"'
                )
                {
                    current.Append('"');
                    index++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }

                continue;
            }

            if (character == ',' && !inQuotes)
            {
                values.Add(current.ToString());
                current.Clear();
                continue;
            }

            current.Append(character);
        }

        values.Add(current.ToString());

        return values;
    }

    private static string NormalizeName(string name)
    {
        var normalized = name.Trim().ToUpperInvariant();

        normalized = normalized
            .Replace("’", "'")
            .Replace("–", "-")
            .Replace("—", "-");

        while (normalized.Contains("  "))
        {
            normalized = normalized.Replace("  ", " ");
        }

        return normalized;
    }
}

public sealed record PopulationRecord(
    string CommunityName,
    int Population,
    int Year,
    string Geography,
    string Source
);
