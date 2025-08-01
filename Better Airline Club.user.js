// ==UserScript==
// @name         [BETA] BAC with H/T/D/T
// @namespace    http://tampermonkey.net/
// @version      2.1.5
// @description  Enhances airline-club.com and v2.airline-club.com airline management game (protip: Sign into your 2 accounts with one on each domain to avoid extra logout/login). Install this script with automatic updates by first installing TamperMonkey/ViolentMonkey/GreaseMonkey and installing it as a userscript.
// @author       Maintained by Fly or die (BAC by Aphix/Torus @ https://gist.github.com/aphix/fdeeefbc4bef1ec580d72639bbc05f2d) (original "Cost Per PAX" portion by Alrianne @ https://github.com/wolfnether/Airline_Club_Mod/) (Service funding cost by Toast @ https://pastebin.com/9QrdnNKr) (With help from Gemini 2.0 and 2.5)
// @match        https://*.airline-club.com/*
// @icon         https://www.airline-club.com/favicon.ico
// @downloadURL  https://github.com/Bohaska/bac/raw/main/Better%20Airline%20Club.user.js
// @updateURL    https://github.com/Bohaska/bac/raw/main/Better%20Airline%20Club.user.js
// @grant        GM_info
// @grant        unsafeWindow
// ==/UserScript==

var MIN_PLANES_TO_HIGHLIGHT = 500; // Changes which planes get the gold shadow/highlight on plane purchase table (not affected by filters in table header)

var REMOVE_MOVING_BACKGROUND = true; // perf enhancement, less noisy -- !!! IF YOU ARE A PATREON MEMBER DISABLE THIS FOR YOUR CUSTOM BACKGROUNDS !!!
var SOLID_BACKGROUND_COLOR = `rgb(83, 85, 113)`; // only matters if REMOVE_MOVING_BACKGROUND is true

// Default filter values for plane purchase table header:
var DEFAULT_MIN_PLANES_IN_CIRCULATION_FILTER = 0; // Changes default minimum number of planes in circulation to remove from plane purchase table
var DEFAULT_MIN_FLIGHT_RANGE_FILTER = 0;
var DEFAULT_RUNWAY_LENGTH_FILTER = 3600;
var DEFAULT_MIN_CAPACITY_FILTER = 0;

var MAIN_PANEL_WIDTH = '62%'; // Percent of screen for all the main (left-side) tables with lists (flight/airplane/etc)
var SIDE_PANEL_WIDTH = '38%'; // Percent of screen for all the right-side details (usually linked with whatever is selected in the main/left panel, e.g. flight details)

// Plugin code starts here and goes to the end...
// Feel free to ping me on the Airline Club Discord @bohaska if you have any suggestions.
// Note from Fly or die: I've released v2 of this mod. Thanks continentalysky for the commission!

function reportAjaxError(error) {
    console.error("Fetch error:");
    if (error.status) { // HTTP status issues
        console.error(`Status: ${error.status} ${error.statusText || ''}`);
        console.error("Response body:", error.responseBody);
    } else { // Network error/other JavaScript error
        console.error("Message:", error.message);
    }
}

function _request(url, method = 'GET', data = undefined) {
    const options = {
        method: method,
        headers: {}
    };
    if (method.toUpperCase() === 'GET' && data && typeof data === 'object') {
        const queryParams = new URLSearchParams(data).toString();
        url = `${url}?${queryParams}`;
    }
    if (data !== undefined && data !== null && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
        options.body = JSON.stringify(data);
        options.headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    return fetch(url, options)
        .then(response => {
            if (!response.ok) {
                return response.json()
                    .catch(() => response.text())
                    .then(errorBody => {
                        const error = new Error(`HTTP error! Status: ${response.status}`);
                        error.status = response.status;
                        error.statusText = response.statusText;
                        error.responseBody = errorBody;
                        throw error;
                    });
            }
            return response.json();
        })
        .catch(error => {
            reportAjaxError(error);
            throw error;
        });
}


function getFactorPercent(consumption, subType) {
    return (consumption.capacity[subType] > 0)
        ? parseInt(consumption.soldSeats[subType] / consumption.capacity[subType] * 100)
        : null;
}

function getLoadFactorsFor(consumption) {
    var factor = {};
    for (let key in consumption.capacity) {
        factor[key] = getFactorPercent(consumption, key) || '-';
    }
    return factor;
}

function _seekSubVal(val, ...subKeys) {
    if (subKeys.length === 0) {
        return val;
    }
    return _seekSubVal(val[subKeys[0]], ...subKeys.slice(1));
}

function averageFromSubKey(array, ...subKeys) {
    return array.map(obj => _seekSubVal(obj, ...subKeys)).reduce((sum, val) => sum += (val || 0), 0) / array.length;
}

function _populateDerivedFieldsOnLink(link, fundingProjection) {
    link.totalCapacity = link.capacity.economy + link.capacity.business + link.capacity.first
    link.totalCapacityHistory = link.capacityHistory.economy + link.capacityHistory.business + link.capacityHistory.first
    link.totalPassengers = link.passengers.economy + link.passengers.business + link.passengers.first
    link.totalLoadFactor = link.totalCapacityHistory > 0 ? Math.round(link.totalPassengers / link.totalCapacityHistory * 100) : 0
    var assignedModel
    if (link.assignedAirplanes && link.assignedAirplanes.length > 0) {
        assignedModel = link.assignedAirplanes[0].airplane.name
    } else {
        assignedModel = "-"
    }
    link.model = assignedModel //so this can be sorted

    // SQ Cost Calculation and Profit Adjustment
    if (fundingProjection && activeAirline && activeAirline.serviceQuality > 0) {
        const capacityForSq = (link.capacityHistory.total > 0) ? link.capacityHistory : link.capacity;
        const tempLinkForSq = { capacity: capacityForSq, distance: link.distance };
        link.sqCost = calculateSqCost(tempLinkForSq, fundingProjection, activeAirline.serviceQuality);
        link.profit -= link.sqCost;
    } else {
        link.sqCost = 0;
    }

    link.profitMarginPercent = link.revenue === 0
        ? 0
    : ((link.profit + link.revenue) / link.revenue) * 100;

    link.profitMargin = link.profitMarginPercent > 100
        ? link.profitMarginPercent - 100
    : (100 - link.profitMarginPercent) * -1;

    link.profitPerPax = link.totalPassengers === 0
        ? 0
    :link.profit / link.totalPassengers;

    link.profitPerFlight = link.profit / link.frequency;
    link.profitPerHour = link.profit / link.duration;
    link.profitPerStaff = link.profit / link.staffInfo.staffBreakdown.total;
}


function getAirportText(city, airportCode) {
    if (city) {
        return city + " (" + airportCode + ")"
    } else {
        return airportCode
    }
}

function plotHistory(linkConsumptions) {
    plotLinkCharts(linkConsumptions)
    document.getElementById("linkHistoryDetails").style.display = '';
}

function getShortModelName(airplaneName) {
    var sections = airplaneName.trim().split(' ').slice(1);

    return sections
        .map(str => (str.includes('-')
                     || str.length < 4
                     || /^[A-Z0-9\-]+[a-z]{0,4}$/.test(str))
             ? str
             : str[0].toUpperCase())
        .join(' ');
}

function getStyleFromTier(tier) {
    const stylesFromGoodToBad = [
        'color:#29FF66;',
        'color:#5AB874;',
        'color:inherit;',

        'color:#FA8282;',
        //'color:#FF3D3D;',
        //'color:#B30E0E;text-shadow:0px 0px 2px #CCC;',

        'color:#FF6969;',
        'color:#FF3D3D;font-weight: bold;',
        // 'color:#FF3D3D;text-decoration:underline',
    ];


    return stylesFromGoodToBad[tier];
}

function getTierFromPercent(val, min = 0, max = 100) {
    var availableRange = max - min;
    var ranges = [
        .95,
        .80,
        .75,
        .6,
        .5
    ].map(multiplier => (availableRange * multiplier) + min);

    var tier;
    if (val > ranges[0]) {
        return 0;
    } else if (val > ranges[1]) {
        return 1;
    } else if (val > ranges[2]) {
        return 2;
    } else if (val > ranges[3]) {
        return 3;
    } else if (val > ranges[4]) {
        return 4;
    }

    return 5;
}

var cachedFundingProjection = null;

/**
 * Fetches the airline's total service funding projection.
 * Caches the result to avoid repeated API calls.
 * @param {number} airlineId The ID of the active airline.
 * @returns {Promise<number>} The funding projection amount.
 */
async function getFundingProjection(airlineId) {
    if (cachedFundingProjection === null) {
        try {
            const result = await _request(`airlines/${airlineId}/service-funding-projection`);
            cachedFundingProjection = result.fundingProjection;
        } catch (e) {
            console.error("Failed to fetch service funding projection. SQ Cost will be 0.", e);
            cachedFundingProjection = 0; // Set to 0 on failure to prevent re-fetching
        }
    }
    return cachedFundingProjection;
}

/**
 * Calculates the Service Quality (SQ) cost for a specific link.
 * The formula is derived from the provided SQ Cost Calculator script.
 * @param {object} link The link object, must contain capacity and distance properties.
 * @param {number} fundingProjection The total projected funding for the airline.
 * @param {number} baseSq The base service quality level set by the airline (0-100).
 * @returns {number} The calculated SQ cost for the link.
 */
function calculateSqCost(link, fundingProjection, baseSq) {
    if (!fundingProjection || !baseSq || !link.capacity || link.capacity.total === 0 || !link.distance) {
        return 0;
    }

    const ecoEquivalentTotalCapacity = Math.floor(link.capacity.economy + (link.capacity.business * 2.5) + (link.capacity.first * 6));
    if (ecoEquivalentTotalCapacity === 0) {
        return 0;
    }

    const linkPassengerMileFreq = ecoEquivalentTotalCapacity * link.distance;
    const qualityComponent = Math.pow(baseSq / 40, 2.5);

    if (qualityComponent === 0) {
         return 0;
    }

    const totalPaxCapacityFreqMileCost = (fundingProjection * 4000) / (qualityComponent * 30);
    if (totalPaxCapacityFreqMileCost === 0) {
        return 0; // Avoid division by zero
    }

    const sqCostProportion = linkPassengerMileFreq / totalPaxCapacityFreqMileCost;
    const finalCost = Math.round(fundingProjection * sqCostProportion);

    return finalCost;
}


async function loadCompetitionForLink(airlineId, link) {
    const linkConsumptions = await _request(`airports/${link.fromAirportId}/to/${link.toAirportId}`);

    document.querySelectorAll("#linkCompetitons .data-row").forEach(el => el.remove());
    linkConsumptions.forEach(function(linkConsumption) {
        var row = document.createElement('div');
        row.className = 'table-row data-row';
        row.innerHTML = `<div style='display: table-cell;'>${linkConsumption.airlineName}</div><div style='display: table-cell;'>${toLinkClassValueString(linkConsumption.price, "$")}</div><div style='display: table-cell; text-align: right;'>${toLinkClassValueString(linkConsumption.capacity)}</div><div style='display: table-cell; text-align: right;'>${linkConsumption.quality}</div><div style='display: table-cell; text-align: right;'>${linkConsumption.frequency}</div>`;

        if (linkConsumption.airlineId == airlineId) {
            document.querySelector("#linkCompetitons .table-header").insertAdjacentElement('afterend', row); //self is always on top
        } else {
            document.getElementById("linkCompetitons").appendChild(row);
        }

    });

    if (document.querySelectorAll("#linkCompetitons .data-row").length == 0) {
        document.getElementById("linkCompetitons").insertAdjacentHTML('beforeend', "<div class='table-row data-row'><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div></div>");
    }

    document.getElementById("linkCompetitons").style.display = '';

    assignAirlineColors(linkConsumptions, "airlineId")
    plotPie(linkConsumptions, null, document.getElementById("linkCompetitionsPie"), "airlineName", "soldSeats")

    return linkConsumptions;
}

function _isFullPax(link, key) {
    return link.passengers[key] === link.capacity[key];
}

function _getPricesFor(link) {
    var linkPrices = {};
    for (var key in link.price) {
        if (key === 'total') continue;

        linkPrices[key] = link.price[key] - 5;
        // linkPrices[key] = link.price[key] - (_isFullPax(link, key) ? 0 : 5);
    }

    return linkPrices;
}

async function _doAutomaticPriceUpdateFor(link) {
    var priceUpdate = {
        fromAirportId: link.fromAirportId,
        toAirportId: link.toAirportId,
        assignedDelegates: 0,
        airplanes: {},
        airlineId: link.assignedAirplanes[0].airplane.ownerId,
        price: _getPricesFor(link),
        model: link.assignedAirplanes[0].airplane.modelId,
        rawQuality: link.rawQuality
    }

    for (var p of link.assignedAirplanes) {
        if (!p.frequency) continue;

        priceUpdate.airplanes[p.airplane.id] = p.frequency;
    }

    const updateResult = await _request(`/airlines/${priceUpdate.airlineId}/links`, 'PUT', priceUpdate);

}

//load history
async function loadHistoryForLink(airlineId, linkId, cycleCount, link) {
    const fundingProjection = await getFundingProjection(airlineId);
    const linkHistory = await _request(`airlines/${airlineId}/link-consumptions/${linkId}?cycleCount=${cycleCount}`);

    if (Object.keys(linkHistory).length === 0) {
        document.getElementById("linkHistoryPrice").textContent = "-";
        document.getElementById("linkHistoryCapacity").textContent = "-";
        document.getElementById("linkLoadFactor").textContent = "-";
        document.getElementById("linkProfit").textContent = "-";
        document.getElementById("linkRevenue").textContent = "-";
        document.getElementById("linkFuelCost").textContent = "-";
        document.getElementById("linkCrewCost").textContent = "-";
        document.getElementById("linkAirportFees").textContent = "-";
        document.getElementById("linkDepreciation").textContent = "-";
        document.getElementById("linkCompensation").textContent = "-";
        document.getElementById("linkLoungeCost").textContent = "-";
        document.getElementById("linkServiceSupplies").textContent = "-";
        document.getElementById("linkMaintenance").textContent = "-";
        document.getElementById("linkOtherCosts").textContent = "-";
        document.getElementById("linkDelays").textContent = "-";
        document.getElementById("linkCancellations").textContent = "-";

        disableButton(document.querySelector("#linkDetails .button.viewLinkHistory"), "Passenger Map is not yet available for this route - please wait for the simulation (time estimation on top left of the screen).")
        disableButton(document.querySelector("#linkDetails .button.viewLinkComposition"), "Passenger Survey is not yet available for this route - please wait for the simulation (time estimation on top left of the screen).")

        plotHistory(linkHistory);
        return;
    }


    if (document.getElementById("linkAverageLoadFactor") === null) {
        document.getElementById("linkLoadFactor").parentElement.insertAdjacentHTML('afterend', `<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Load Factor:</h5></div>
            <div class="value" id="linkAverageLoadFactor"></div>
        </div>`)
    }

    if (document.getElementById("linkAverageProfit")  === null) {
        document.getElementById("linkProfit").parentElement.insertAdjacentHTML('afterend', `<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Profit:</h5></div>
            <div class="value" id="linkAverageProfit"></div>
        </div>`)
    }

    const averageLoadFactor = getLoadFactorsFor({
        soldSeats: {
            economy: averageFromSubKey(linkHistory, 'soldSeats', 'economy'),
            business: averageFromSubKey(linkHistory, 'soldSeats', 'business'),
            first: averageFromSubKey(linkHistory, 'soldSeats', 'first'),
        },
        capacity: {
            economy: averageFromSubKey(linkHistory, 'capacity', 'economy'),
            business: averageFromSubKey(linkHistory, 'capacity', 'business'),
            first: averageFromSubKey(linkHistory, 'capacity', 'first'),
        }
    });

    var latestLinkData = linkHistory[0]

    // SQ Cost calculation and display
    let sqCost = 0;
    if (fundingProjection && activeAirline && activeAirline.serviceQuality > 0) {
        const tempLinkForSq = { capacity: latestLinkData.capacity, distance: link.distance };
        sqCost = calculateSqCost(tempLinkForSq, fundingProjection, activeAirline.serviceQuality);
    }

    if (document.getElementById("linkSqCost")  === null) {
        document.getElementById("linkServiceSupplies").parentElement.insertAdjacentHTML('afterend', `<div class="table-row">
            <div class="label"><h5>Service Funding:</h5></div>
            <div class="value" id="linkSqCost"></div>
        </div>`);
    }
    document.getElementById("linkSqCost").textContent = '$' + commaSeparateNumber(sqCost)

    // Adjust profit
    latestLinkData.profit -= sqCost;
    // Note: Average profit over time is not adjusted as SQ settings could have changed.

    document.getElementById("linkHistoryPrice").textContent = toLinkClassValueString(latestLinkData.price, "$")
    document.getElementById("linkHistoryCapacity").textContent = toLinkClassValueString(latestLinkData.capacity)

    if (latestLinkData.totalLoadFactor !== 100) {
        let originalLink = link;
        //console.dir(originalLink);
        document.getElementById("doAutomaticPriceUpdate").addEventListener('click', () => {
            _doAutomaticPriceUpdateFor(originalLink);
        });

        document.getElementById("doAutomaticPriceUpdate").style.display = '';
    } else {
        document.getElementById("doAutomaticPriceUpdate").style.display = 'none';
    }

    document.getElementById("linkLoadFactor").textContent = toLinkClassValueString(getLoadFactorsFor(latestLinkData), "", "%")
    document.getElementById("linkAverageLoadFactor").textContent = toLinkClassValueString(averageLoadFactor, "", "%")

    const dollarValuesByElementId = {
        linkProfit: latestLinkData.profit,
        linkAverageProfit: Math.round(averageFromSubKey(linkHistory, 'profit')),
        linkRevenue: latestLinkData.revenue,
        linkFuelCost: latestLinkData.fuelCost,
        linkCrewCost: latestLinkData.crewCost,
        linkAirportFees: latestLinkData.airportFees,
        linkDepreciation: latestLinkData.depreciation,
        linkCompensation: latestLinkData.delayCompensation,
        linkLoungeCost: latestLinkData.loungeCost,
        linkServiceSupplies: latestLinkData.inflightCost,
        linkMaintenance: latestLinkData.maintenanceCost,
    };

    for (const elementId in dollarValuesByElementId) {
        document.getElementById(elementId).textContent = '$' + commaSeparateNumber(dollarValuesByElementId[elementId]);
    }

    if (latestLinkData.minorDelayCount == 0 && latestLinkData.majorDelayCount == 0) {
        document.getElementById("linkDelays").classList.remove("warning")
        document.getElementById("linkDelays").textContent = "-"
    } else {
        document.getElementById("linkDelays").classList.add("warning")
        document.getElementById("linkDelays").textContent = latestLinkData.minorDelayCount + " minor " + latestLinkData.majorDelayCount + " major"
    }

    if (latestLinkData.cancellationCount == 0) {
        document.getElementById("linkCancellations").classList.remove("warning")
        document.getElementById("linkCancellations").textContent = "-"
    } else {
        document.getElementById("linkCancellations").classList.add("warning")
        document.getElementById("linkCancellations").textContent = latestLinkData.cancellationCount
    }
    enableButton(document.querySelector("#linkDetails .button.viewLinkHistory"))
    enableButton(document.querySelector("#linkDetails .button.viewLinkComposition"))

    plotHistory(linkHistory);

    $('#linkEventChart').data('linkConsumptions', linkHistory); // Keep .data()
    return linkHistory;
}

async function loadLinkSurvey(airlineId, link) {
    if (!document.getElementById("paxOrigin")) {
        document.getElementById("linkProfit").parentElement.insertAdjacentHTML('beforebegin', `<div class="table-row">
        <div class="label">
        <h5>Origin (H/T/D/T):
        <div class="tooltip">
<img src="/assets/images/icons/information.png">
<span class="tooltiptext below" style="white-space: nowrap;">H: Pax from home airport<br>T: Transit pax going through home airport<br>D: Pax from destination airport<br>T: Transit pax going through destination airport
<br></span>
</div>
        </h5>
        </div>
        <div class="value" id="paxOrigin"></div>
    </div>`);
    };
    if (!document.getElementById("paxType")) {
        document.getElementById("paxOrigin").parentElement.insertAdjacentHTML('afterend', `<div class="table-row">
        <div class="label">
        <h5>Type (B/S/L):
        <div class="tooltip">
<img src="/assets/images/icons/information.png">
<span class="tooltiptext below" style="white-space: nowrap;">B: Budget (and Simple) pax (Cares about price)<br>S: Swift pax (Cares about frequency)<br>L: Compehensive + Brand Aware + Elite pax (Cares about quality & loyalty)<br>L pax are 3x better at generating loyalists compared to B and S pax<br>Check the survey button for more info on pax types
<br></span>
</div>
        </h5>
        </div>
        <div class="value" id="paxType"></div>
    </div>`);
    };
    if (!document.getElementById("newLoyalists")) {
        document.getElementById("paxType").parentElement.insertAdjacentHTML('afterend', `<div class="table-row">
        <div class="label">
        <h5>New Loyalists (B/S/L):
        </h5>
        <div class="tooltip">
<img src="/assets/images/icons/information.png">
<span class="tooltiptext below" style="white-space: nowrap;">The approximate amount of new loyalists your airline gains from this route<br>Assumes all pax on your route don't take transits, conversion rate is reduced for transit pax<br>Budget and Swift pax can only convert loyalists at 30% of regular rate
<br></span>
</div>
        </div>
        <div class="value" id="newLoyalists"></div>
    </div>`);
    };
    document.getElementById("paxOrigin").textContent = '';
    document.getElementById("paxType").textContent = '';
    document.getElementById("newLoyalists").textContent = '';
    const survey = await _request(`airlines/${airlineId}/link-composition/${link.id}`);
    const passengerMap = await _request(`airlines/${airlineId}/related-link-consumption/${link.id}?cycleDelta=0&economy=true&business=true&first=true`);
    var homeAirportPax = 0;
    var destinationAirportPax = 0;
    var homeTransitPax = 0;
    var destinationTransitPax = 0;
    var cheapPax = 0;
    var swiftPax = 0;
    var loyalistPax = 0;
    var comprehensivePax = 0;
    var brandConsciousPax = 0;
    var elitePax = 0;
    var simplePax = 0;
    var budgetPax = 0;
    var cheapNewLoyalists = 0;
    var swiftNewLoyalists = 0;
    var loyalNewLoyalists = 0;
    for (var i = 0; i < survey.homeAirports.length; i++) {
        if (survey.homeAirports[i].airport === `${link.fromAirportCity}(${link.fromAirportCode})`) {
            homeAirportPax = survey.homeAirports[i].passengerCount;
        } else {
        if (survey.homeAirports[i].airport === `${link.toAirportCity}(${link.toAirportCode})`) {
            destinationAirportPax = survey.homeAirports[i].passengerCount;
        }
        }
    }
    for (i = 0; i < passengerMap.relatedLinks.length; i++) {
        if (passengerMap.relatedLinks[i][0].linkId === link.id) {
            try {
                for (var j = 0; j < passengerMap.relatedLinks[i-1].length; j++) {
                    homeTransitPax += passengerMap.relatedLinks[i-1][j].passenger
                }
            } catch (TypeError) {
                    homeTransitPax = 0
            }
        }
    }
    for (i = 0; i < passengerMap.invertedRelatedLinks.length; i++) {
        if (passengerMap.invertedRelatedLinks[i][0].linkId === link.id) {
            try {
                for (j = 0; j < passengerMap.invertedRelatedLinks[i-1].length; j++) {
                    destinationTransitPax += passengerMap.invertedRelatedLinks[i-1][j].passenger
                }
            } catch (TypeError) {
                destinationTransitPax = 0
            }
        }
    }
    for (i = 0; i < survey.preferenceType.length; i++) {
        if (survey.preferenceType[i].title === "Budget") {
            budgetPax += survey.preferenceType[i].passengerCount;
            cheapPax += survey.preferenceType[i].passengerCount;
            cheapNewLoyalists += parseInt(survey.preferenceType[i].passengerCount * 0.3 * Math.max((survey.preferenceSatisfaction[i].satisfaction - 0.6) * 2.5, 0));
        } else {
            if (survey.preferenceType[i].title === "Swift") {
                swiftPax += survey.preferenceType[i].passengerCount;
                swiftNewLoyalists += parseInt(survey.preferenceType[i].passengerCount * 0.3 * Math.max((survey.preferenceSatisfaction[i].satisfaction - 0.6) * 2.5, 0));
            } else {
                if (survey.preferenceType[i].title === "Comprehensive") {
                    comprehensivePax += survey.preferenceType[i].passengerCount;
                    loyalistPax += survey.preferenceType[i].passengerCount;
                    loyalNewLoyalists += parseInt(survey.preferenceType[i].passengerCount * Math.max((survey.preferenceSatisfaction[i].satisfaction - 0.6) * 2.5, 0));

                } else {
                    if (survey.preferenceType[i].title === "Brand Conscious") {
                        brandConsciousPax += survey.preferenceType[i].passengerCount;
                        loyalistPax += survey.preferenceType[i].passengerCount;
                        loyalNewLoyalists += parseInt(survey.preferenceType[i].passengerCount * Math.max((survey.preferenceSatisfaction[i].satisfaction - 0.6) * 2.5, 0));
                    } else {
                        if (survey.preferenceType[i].title === "Elite") {
                            elitePax += survey.preferenceType[i].passengerCount;
                            loyalistPax += survey.preferenceType[i].passengerCount;
                            loyalNewLoyalists += parseInt(survey.preferenceType[i].passengerCount * Math.max((survey.preferenceSatisfaction[i].satisfaction - 0.6) * 2.5, 0));
                        } else {
                            if (survey.preferenceType[i].title === "Simple") {
                                simplePax += survey.preferenceType[i].passengerCount;
                                cheapPax += survey.preferenceType[i].passengerCount;
                                cheapNewLoyalists += parseInt(survey.preferenceType[i].passengerCount * 0.3 * Math.max((survey.preferenceSatisfaction[i].satisfaction - 0.6) * 2.5, 0));
                            }
                        }
                    }
                }
            }
        }
    }
    document.getElementById("paxOrigin").textContent = `${homeAirportPax}/${homeTransitPax}/${destinationAirportPax}/${destinationTransitPax}`;
    document.getElementById("paxType").textContent = `${cheapPax}/${swiftPax}/${loyalistPax}`;
    document.getElementById("newLoyalists").textContent = `${cheapNewLoyalists}/${swiftNewLoyalists}/${loyalNewLoyalists}`;
}

let lastPlotUnit;
unsafeWindow._getPlotUnit = function _getPlotUnit() {
    let checkedElem = document.querySelector('#linkDetails fieldset .switch input:checked');

    if (!checkedElem && lastPlotUnit) {
        return lastPlotUnit;
    }

    return lastPlotUnit = unsafeWindow.plotUnitEnum[checkedElem ? checkedElem.value.toUpperCase() : 'MONTH']
}

unsafeWindow.loadLink = async function loadLink(airlineId, linkId) {
    const link = await _request(`airlines/${airlineId}/links/${linkId}`)

    $('#linkEventModal').data('link', link) // Keep .data()
    document.getElementById("linkFromAirport").setAttribute("onclick", "showAirportDetails(" + link.fromAirportId + ")");
    document.getElementById("linkFromAirport").innerHTML = getCountryFlagImg(link.fromCountryCode) + getAirportText(link.fromAirportCity, link.fromAirportCode);
    document.getElementById("linkToAirport").setAttribute("onclick", "showAirportDetails(" + link.toAirportId + ")");
    document.getElementById("linkToAirport").innerHTML = getCountryFlagImg(link.toCountryCode) + getAirportText(link.toAirportCity, link.toAirportCode);
    document.getElementById("linkFlightCode").textContent = link.flightCode;
    if (link.assignedAirplanes && link.assignedAirplanes.length > 0) {
        document.getElementById('linkAirplaneModel').textContent = link.assignedAirplanes[0].airplane.name + "(" + link.assignedAirplanes.length + ")";
    } else {
        document.getElementById('linkAirplaneModel').textContent = "-";
    }
    document.getElementById("linkCurrentPrice").textContent = toLinkClassValueString(link.price, "$");
    document.getElementById("linkDistance").textContent = link.distance + " km (" + link.flightType + ")";
    document.getElementById("linkQuality").innerHTML = getGradeStarsImgs(Math.round(link.computedQuality / 10)) + link.computedQuality;
    document.getElementById("linkCurrentCapacity").textContent = toLinkClassValueString(link.capacity);
    if (link.future) {
        document.querySelector("#linkCurrentDetails .future .capacity").textContent = toLinkClassValueString(link.future.capacity);
        document.querySelector("#linkCurrentDetails .future").style.display = '';
    } else {
        document.querySelector("#linkCurrentDetails .future").style.display = 'none';
    }
    document.getElementById("linkCurrentDetails").style.display = '';

    document.getElementById("linkToAirportId").value = link.toAirportId;
    document.getElementById("linkFromAirportId").value = link.fromAirportId;

    const plotUnit = _getPlotUnit();
    const cycleCount = plotUnit.maxWeek;

    const [
        linkCompetition,
        linkHistory,
        linkSurvey,
    ] = await Promise.all([
        loadCompetitionForLink(airlineId, link),
        loadHistoryForLink(airlineId, linkId, cycleCount, link),
        loadLinkSurvey(airlineId, link),
    ])

    var explicitlySelectedModelId = $("#planLinkModelSelect").data('explicitId') // Keep .data()
    const assignedModelId = link.modelId
    var selectedModelId
    if (explicitlySelectedModelId) {
        selectedModelId = explicitlySelectedModelId;
    } else {
        selectedModelId = assignedModelId
    }

    if (Object.values(loadedModelsById).length == 0) loadAirplaneModels();
    const fromAirport = airports.find(a => a.id == link.fromAirportId)
    const toAirport = airports.find(a => a.id == link.toAirportId)
    const minRunway = Math.min(fromAirport.runwayLength, toAirport.runwayLength)

    link.fromAirport = fromAirport
    link.toAirport = toAirport
    $("#detailsPanel").data(link) // Keep .data()

    var arrayModels = Object.values(loadedModelsById)
    arrayModels.forEach(function(modelPlanLinkInfo) {
        if (modelPlanLinkInfo.id == selectedModelId) {
            modelPlanLinkInfo.owned = true
        } else {
            modelPlanLinkInfo.owned = false
        }
    })
    arrayModels = sortPreserveOrder(arrayModels, "owned", false)

    document.querySelectorAll("#viewLinkModelSelect option").forEach(el => el.remove());
    arrayModels.forEach(function(model) {
        var modelId = model.id
        var modelname = model.name
        if (model.range >= link.distance && model.runwayRequirement <= minRunway) {
            let flightDuration = calcFlightTime(model, link.distance);
            let maxFlightMinutes = 4 * 24 * 60;
            let frequency = Math.floor(maxFlightMinutes / ((flightDuration + model.turnaroundTime) * 2));
            var option = document.createElement("option");
            option.value = modelId;
            option.textContent = modelname + " (" + frequency + ")";
            document.getElementById("viewLinkModelSelect").appendChild(option);
            if (selectedModelId == modelId) {
                option.selected = true;
                option.classList.add("highlight-text");
                linkUpdateModelInfo(modelId);
            }
        }
    });

    document.getElementById("viewLinkModelSelect").style.display = '';
    setActiveDiv($("#extendedPanel #airplaneModelDetails"))

    return {
        link,
        linkCompetition,
        linkHistory,
        linkSurvey,
    };
}

const _editLink = unsafeWindow.editLink
unsafeWindow.editLink = function editLink(linkId) {
    document.getElementById("viewLinkModelSelect").style.display = 'none';
    _editLink(linkId)
}

const _cancelPlanLink = unsafeWindow.cancelPlanLink;
unsafeWindow.cancelPlanLink = function cancelPlanLink() {
    _cancelPlanLink(); // Call original function first
    if (!tempPath) { // Logic from Script 2: if we are cancelling an *edit* (not a new link)
        if (document.querySelector("#viewLinkModelSelect").selectedOptions.length > 0) {
            document.querySelector("#viewLinkModelSelect").selectedOptions[0].selected = false
        }
        // Original: $(document.querySelector("#viewLinkModelSelect").options).filter(function(i, option) {return option.value == document.querySelector("#planLinkModelSelect").selectedOptions[0].value})[0].selected = true;
        // Replaced jQuery filter with native Array.prototype.filter
        Array.from(document.querySelector("#viewLinkModelSelect").options).filter(option => option.value == document.querySelector("#planLinkModelSelect").selectedOptions[0].value)[0].selected = true;
        document.getElementById("viewLinkModelSelect").style.display = '';
        setActiveDiv($('#linkDetails'))
    }
}


async function _updateLatestOilPriceInHeader() {
    const oilPrices = await _request('oil-prices');
    const latestPrice = oilPrices.slice(-1)[0].price;

    if (!document.querySelector('.topBarDetails .latestOilPriceShortCut')) {
        document.querySelector('.topBarDetails .delegatesShortcut').insertAdjacentHTML('afterend', `
            <span style="margin: 0px 10px; padding: 0 5px"  title="Latest Oil Price" class="latestOilPriceShortCut clickable" onclick="showOilCanvas()">
                <span class="latest-price label" style=""></span>
            </span>
        `);
    }

    const tierForPrice = 5 - getTierFromPercent(latestPrice, 40, 80);
    const latestOilPriceShortCut = document.querySelector('.latestOilPriceShortCut');

    if (tierForPrice < 2) {
        latestOilPriceShortCut.classList.add('glow', 'button');
    } else {
        latestOilPriceShortCut.classList.remove('glow', 'button');
    }

    const latestPriceSpan = document.querySelector('.topBarDetails .latest-price');
    latestPriceSpan.textContent = '$'+commaSeparateNumber(latestPrice);
    latestPriceSpan.setAttribute('style', getStyleFromTier(tierForPrice));

    setTimeout(() => {
        _updateLatestOilPriceInHeader();
    }, Math.round(Math.max(typeof durationTillNextTick !== 'undefined' ? durationTillNextTick / 2 : 60000, 60000)));
}

function commaSeparateNumberForLinks(val) {
    const over1k = val > 1000 || val < -1000;
    const isNegative = (val < 0);

    if (val !== 0) {
        const withDecimal = Math.abs(over1k ? val / 1000 : val);
        const remainderTenths = Math.round((withDecimal % 1) * 10) / 10;
        val = Math.floor(withDecimal) + remainderTenths;

        while (/(\d+)(\d{3})/.test(val.toString())) {
            val = val.toString().replace(/(\d+)(\d{3})/, '$1'+','+'$2');
        }
    }

    const valWithSuffix = over1k ? val + 'k' : val;

    return isNegative ? '(' + valWithSuffix + ')' : valWithSuffix;
}

var _pluralize = (val, str) => `${val} ${str}${val === 1 ? '' : 's'}`
var _twoDigit = (val) => padBefore(val, "0", 2)

var totalmillisecPerWeek = 7 * 24 * 60 * 60 * 1000
var refreshInterval = 1500 //every 5 second
var incrementPerInterval = totalmillisecPerWeek / (40 * 60 * 1000) * refreshInterval //by default 40 minutes per week (was 15)
var durationTillNextTick
var hasTickEstimation = false
var refreshIntervalTimer
var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var _updateIntervalTimeout;


function _refreshTicks() {
    currentTime += incrementPerInterval
    if (hasTickEstimation) {
        durationTillNextTick -= refreshInterval
    }
    var date = new Date(currentTime)
    //$(".currentTime").text("(" + days[date.getDay()] + ") " + padBefore(date.getMonth() + 1, "0", 2) + '/' + padBefore(date.getDate(), "0", 2) +  " " + padBefore(date.getHours(), "0", 2) + ":" +padBefore(date.getMinutes(), "0", 2))

    var _updateTimeTextIfNeeded = () => null;
    if (hasTickEstimation) {
        var minutesLeft = Math.round(durationTillNextTick / 1000 / 60);
        let unit = minutesLeft <= 0 ? 'second' : 'minute';
        let count = unit === 'minute' ? minutesLeft : Math.round(minutesLeft / 60);
        _updateTimeTextIfNeeded = () => document.querySelector(".nextTickEstimation").textContent = _pluralize(count, unit);
    }

    requestAnimationFrame(() => {
        document.querySelector(".currentTime").textContent = `(${days[date.getDay()]}) ${_twoDigit(date.getMonth() + 1)}/${_twoDigit(date.getDate())} ${_twoDigit(date.getHours())}:${_twoDigit(date.getMinutes())}`;
        _updateTimeTextIfNeeded();
    });

    _updateIntervalTimeout = setTimeout(() => _refreshTicks(), refreshInterval);
}

var _updateTime = unsafeWindow.updateTime = function updateTime(cycle, fraction, cycleDurationEstimation) {
    console.log('internal updateTime');
    console.dir({cycle, fraction, cycleDurationEstimation});

    document.querySelector(".currentTime").setAttribute("title", "Current Cycle: " + cycle);
    currrentCycle = currrentCycle = cycle
    currentTime = (cycle + fraction) * totalmillisecPerWeek
    if (_updateIntervalTimeout) {
        //cancel old timer
        clearTimeout(_updateIntervalTimeout)
    }

    if (cycleDurationEstimation > 0) { //update incrementPerInterval
        incrementPerInterval = totalmillisecPerWeek / cycleDurationEstimation * refreshInterval
        durationTillNextTick = cycleDurationEstimation * (1 - fraction)
        hasTickEstimation = true
    }

    _refreshTicks();
}

unsafeWindow.onMessage = function onMessage(evt) { //right now the message is just the cycle #, so refresh the panels
    console.log('onMessagehit');
    var json = JSON.parse(evt.data)
    if (json.ping) { //ok
        console.debug("ping : " + json.ping)
        return
    }
    console.log("websocket received message : " + evt.data)

    if (json.messageType == "cycleInfo") { //update time
        unsafeWindow.updateTime(json.cycle, json.fraction, json.cycleDurationEstimation)
        //  } else if (json.messageType == "cycleStart") { //update time
        //      updateTime(json.cycle, 0)
    } else if (json.messageType == "cycleCompleted") {
        if (selectedAirlineId) {
            refreshPanels(selectedAirlineId)
        }
    } else if (json.messageType == "broadcastMessage") {
        queuePrompt("broadcastMessagePopup", json.message)
    } else if (json.messageType == "airlineMessage") {
        queuePrompt("airlineMessagePopup", json.message)
    } else if (json.messageType == "notice") {
        queueNotice(json)
    } else if (json.messageType == "tutorial") {
        queueTutorialByJson(json)
    } else if (json.messageType == "pendingAction") {
        handlePendingActions(json.actions)
    } else {
        console.warn("unknown message type " + evt.data)
    }
}

function launch(){

    unsafeWindow.plotUnitEnum = {
        "WEEK": {
            "value": 4,
            "maxWeek": 28,
            "weeksPerMark": 1,
            "maxMark": 28
        },
        "MONTH": {
            "value": 1,
            "maxWeek": 104,
            "weeksPerMark": 4,
            "maxMark": 28
        },
        "QUARTER": {
            "value": 2,
            "maxWeek": 168,
            "weeksPerMark": 12,
            "maxMark": 28
        },
        "YEAR": {
            "value": 3,
            "maxWeek": 300,
            "weeksPerMark": 52,
            "maxMark": 28
        }
    }

    unsafeWindow.commaSeparateNumberForLinks = commaSeparateNumberForLinks;

    var cachedTotalsById = unsafeWindow.cachedTotalsById = {};
    unsafeWindow.cachedTotalsById = cachedTotalsById;

    unsafeWindow.loadAirplaneModelStats = async function loadAirplaneModelStats(modelInfo, opts = {}) {
        var url
        var favoriteIcon = document.querySelector("#airplaneModelDetail .favorite");
        var model = loadedModelsById[modelInfo.id]
        if (activeAirline) {
            url = "airlines/" + activeAirline.id + "/airplanes/model/" + model.id + "/stats",
            favoriteIcon.style.display = '';
        } else {
            url = "airplane-models/" + model.id + "/stats"
            favoriteIcon.style.display = 'none';
        }

        if (opts && opts.totalOnly && model.in_use  && model.in_use !== -1) {
            return;
        }

        if (opts && opts.totalOnly && cachedTotalsById[model.id]) {
            model.in_use = cachedTotalsById[model.id];
            return;
        }

        const stats = await _request(url);

        if (opts && opts.totalOnly) {
            cachedTotalsById[model.id] = model.in_use = stats.total;
            return;
        }

        updateTopOperatorsTable(stats)
        document.querySelector('#airplaneCanvas .total').textContent = stats.total;

        cachedTotalsById[model.id] = model.in_use = stats.total;

        if (stats.favorite === undefined) {
            return;
        }

        $("#airplaneModelDetail .favorite").off() //remove all listeners -- Keeping this as is, direct native replacement is ambiguous here for general 'off()'

        if (stats.favorite.rejection) {
            $("#setFavoriteModal").data("rejection", stats.favorite.rejection) // Keep .data()
        } else {
            $("#setFavoriteModal").removeData("rejection") // Keep .removeData()
        }

        if (modelInfo.isFavorite) {
            favoriteIcon.setAttribute("src", "assets/images/icons/heart.png");
            $("#setFavoriteModal").data("rejection", "This is already the Favorite") // Keep .data()
        } else {
            favoriteIcon.setAttribute("src", "assets/images/icons/heart-empty.png");
        }

        $("#setFavoriteModal").data("model", model) // Keep .data()
    }

    unsafeWindow.updateCustomLinkTableHeader = function updateCustomLinkTableHeader() {
        if (document.getElementById('linksTableSortHeader').children.length === 16) {
            return;
        }

        document.querySelector('#linksCanvas .mainPanel').style.width = MAIN_PANEL_WIDTH;
        document.querySelector('#linksCanvas .sidePanel').style.width = SIDE_PANEL_WIDTH;

        document.querySelector('#canvas .mainPanel').style.width = MAIN_PANEL_WIDTH;
        document.querySelector('#canvas .sidePanel').style.width = SIDE_PANEL_WIDTH;

        // [KEPT] Column widths from Script 1
        const widths = [
            8,
            8,
            8,
            6,
            11,
            4,
            5,
            5,
            8,
            7,
            5,
            5,
            6,
            6,
            6,
            2, //tiers, 1st
        ];

        const sum = widths.reduce((acc, val) => acc + val, 0);
        if (sum !== 100) {
            console.warn(`Column widths to not add up to 100: ${sum} (${widths.join(',')}) -- ${sum < 100 ? 'Remaining' : 'Over by'}: ${sum < 100 ? 100 - sum : sum - 100}%`)
        }

        document.getElementById('linksTableSortHeader').innerHTML = `
            <div class="cell clickable" style="width: ${widths[15]}%" data-sort-property="tiersRank" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))" title="Aggregated Rank">#</div>
            <div class="cell clickable" style="width: ${widths[0]}%" data-sort-property="fromAirportCode" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))">From</div>
            <div class="cell clickable" style="width: 0%" data-sort-property="lastUpdate" data-sort-order="ascending" id="hiddenLinkSortBy"></div> <!--hidden column for last update (cannot be first otherwise the left round corner would not work -->
            <div class="cell clickable" style="width: ${widths[1]}%" data-sort-property="toAirportCode" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))">To</div>
            <div class="cell clickable" style="width: ${widths[2]}%" data-sort-property="model" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Model</div>
            <div class="cell clickable" style="width: ${widths[3]}%" align="right" data-sort-property="distance" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Dist.</div>
            <div class="cell clickable" style="width: ${widths[4]}%" align="right" data-sort-property="totalCapacity" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Capacity (Freq.)</div>
            <div class="cell clickable" style="width: ${widths[5]}%" align="right" data-sort-property="totalPassengers" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Pax</div>
            <div class="cell clickable" style="width: ${widths[6]}%" align="right" data-sort-property="totalLoadFactor" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))" title="Load Factor">LF</div>
            <div class="cell clickable" style="width: ${widths[7]}%" align="right" data-sort-property="satisfaction" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))" title="Satisfaction Factor">SF</div>
            <div class="cell clickable" style="width: ${widths[8]}%" align="right" data-sort-property="revenue" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Revenue</div>
            <div class="cell clickable" style="width: ${widths[9]}%" align="right" data-sort-property="profit" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))">Profit</div>
            <div class="cell clickable" style="width: ${widths[10]}%" align="right" data-sort-property="profitMargin" title="Profit Margin" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Gain</div>
            <div class="cell clickable" style="width: ${widths[11]}%" align="right" data-sort-property="profitPerPax" title="Profit PerPax" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/🧍</div>
            <div class="cell clickable" style="width: ${widths[12]}%" align="right" data-sort-property="profitPerFlight" title="Profit Per Flight" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/✈</div>
            <div class="cell clickable" style="width: ${widths[13]}%" align="right" data-sort-property="profitPerHour" title="Profit Per Hour" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/⏲</div>
            <div class="cell clickable" style="width: ${widths[14]}%" align="right" data-sort-property="profitPerStaff" title="Profit Per Staff" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/👨‍💼</div>
        `);

        document.querySelector('#linksTable .table-header').innerHTML = `
            <div class="cell" style="width: ${widths[15]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[0]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[1]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[2]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[3]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[4]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[5]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[6]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[7]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[8]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[9]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[10]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[11]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[12]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[13]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[14]}%; border-bottom: none;"></div>
        `);
    }

    unsafeWindow.loadLinksTable = async function loadLinksTable() {
        const fundingProjection = await getFundingProjection(activeAirline.id);
        const links = await _request(`airlines/${activeAirline.id}/links-details`);

        await Promise.all(links.map(async link => {
            link.staffInfo = await _getOvertimeAndStaffInfoForLink(link);
        }))

        _updateChartOptionsIfNeeded();
        updateCustomLinkTableHeader();
        updateLoadedLinks(links);

        links.forEach((link) => _populateDerivedFieldsOnLink(link, fundingProjection));

        var selectedSortHeader = document.querySelector('#linksTableSortHeader .cell.selected');
        updateLinksTable($('#linksTableSortHeader .cell.selected').data('sort-property'), $('#linksTableSortHeader .cell.selected').data('sort-order'))
    }

    var colorKeyMaps = {};
    unsafeWindow.updateLinksTable = function updateLinksTable(sortProperty, sortOrder) {
        var linksTable = document.getElementById("linksTable");
        linksTable.querySelectorAll("div.table-row").forEach(el => el.remove());

        loadedLinks = sortPreserveOrder(loadedLinks, sortProperty, sortOrder == "ascending")

        function getKeyedStyleFromLink(link, keyName, ...args) {
            if (!colorKeyMaps[keyName]) {
                colorKeyMaps[keyName] = new WeakMap();
            } else if (colorKeyMaps[keyName].has(link)) {
                return colorKeyMaps[keyName].get(link);
            }

            var data = loadedLinks.map(l => l[keyName]);

            var avg = data.reduce((sum, acc) => sum += acc, 0) / loadedLinks.length;
            var max = Math.max(...data);
            var min = Math.max(Math.min(...data), 0);

            var tier = getTierFromPercent(link[keyName], args[0] !== undefined ? args[0] : min, args[1] || (avg * .618));
            if (!link.tiers) {
                link.tiers = {};
            }

            link.tiers[keyName] = tier;

            var colorResult = getStyleFromTier(tier);

            colorKeyMaps[keyName].set(link, colorResult);

            return colorResult;
        }

        loadedLinks.forEach(function(link) {
            var row = document.createElement('div');
            row.className = 'table-row clickable';
            row.setAttribute('onclick', 'selectLinkFromTable($(this), ' + link.id + ')'); // Keep $(this) as it's passed to another function

            var srcAirportFull = getAirportText(link.fromAirportCity, link.fromAirportCode);
            var destAirportFull = getAirportText(link.toAirportCity, link.toAirportCode);

            // Using Truncated view from Script 1 as default
            row.insertAdjacentHTML('beforeend', "<div class='cell' title='"+ srcAirportFull +"'>" + getCountryFlagImg(link.fromCountryCode) + ' ' + srcAirportFull.slice(-4, -1) + "</div>");
            row.insertAdjacentHTML('beforeend', "<div class='cell' title='"+ destAirportFull +"'>" + getCountryFlagImg(link.toCountryCode) + ' ' + destAirportFull.slice(-4, -1) + "</div>");

            row.insertAdjacentHTML('beforeend', "<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;'>" + getShortModelName(link.model) + "</div>");
            row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + link.distance + "km</div>");
            row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + link.totalCapacity + " (" + link.frequency + ")</div>");
            row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + link.totalPassengers + "</div>");

            const lfBreakdown = {
                economy: link.passengers.economy / link.capacity.economy,
                business: link.passengers.business / link.capacity.business,
                first: link.passengers.first / link.capacity.first,
            };

            let lfBreakdownText = link.totalLoadFactor === 100
                ? '100'
                : [lfBreakdown.economy, lfBreakdown.business, lfBreakdown.first].map(v => v ? Math.floor(100 * v) : '-').join('/').replace(/(\/\-)+$/g, '')

            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'totalLoadFactor', 0, 100)+"' class='cell' align='right'>" + lfBreakdownText + '%' + "</div>");

            row.insertAdjacentHTML('beforeend', "<div style='" + getKeyedStyleFromLink(link, "satisfaction", 0.6, 1) + "' class='cell' align='right'>" + Math.round(Math.max(link.satisfaction - 0.6, 0) * 250) + "%" + "</div>");

            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'revenue')+"'  class='cell' align='right' title='$"+ commaSeparateNumber(link.revenue) +"'>" + '$' + commaSeparateNumberForLinks(link.revenue) + "</div>");
            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'profit')+"'  class='cell' align='right' title='$"+ commaSeparateNumber(link.profit) +"'>" + '$' + commaSeparateNumberForLinks(link.profit) +"</div>");

            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'profitMarginPercent', 0, 136.5)+"' class='cell' align='right'>" + (link.profitMargin > 0 ? '+' : '') + Math.round(link.profitMargin) + "%</div>");

            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'profitPerPax')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerPax) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerPax) + "</div>");
            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'profitPerFlight')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerFlight) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerFlight) + "</div>");
            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'profitPerHour')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerHour) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerHour) + "</div>");
            row.insertAdjacentHTML('beforeend', "<div style='"+getKeyedStyleFromLink(link, 'profitPerStaff')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerStaff) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerStaff) + "</div>");

            if (selectedLink == link.id) {
                row.classList.add("selected");
            }

            const tiersRank = link.tiersRank = Object.keys(link.tiers).reduce((sum, key) => sum + link.tiers[key] + (key === 'profit' && link.tiers[key] === 0 ? -1 : 0), 0);

            row.insertAdjacentHTML('afterbegin', "<div class='cell'>" + link.tiersRank + "</div>");

            if (tiersRank < 2) {
                row.style.textShadow = '0 0 3px gold';
            }

            if (tiersRank > 27) {
                row.style.textShadow = '0 0 3px red';
            }

            linksTable.appendChild(row);
        });
    }

    unsafeWindow.refreshLinkDetails = async function refreshLinkDetails(linkId) {
        const airlineId = activeAirline.id

        document.querySelectorAll("#linkCompetitons .data-row").forEach(el => el.remove());
        document.getElementById("actionLinkId").value = linkId;

        // load link
        const linkDetailsPromise = loadLink(airlineId, linkId); // not awaiting yet so we can kickoff the panel open animation while loading

        setActiveDiv($("#linkDetails"));
        hideActiveDiv(document.querySelector("#extendedPanel #airplaneModelDetails"));
        document.getElementById('sidePanel').style.display = 'block'; // Direct display for fadeIn, since fadeIn is a complex animation

        const { link, linkCompetition, linkHistory } = await linkDetailsPromise; // link details loaded if needed for something later
    }

    async function _getOvertimeAndStaffInfoForLink(link) {
        const airplaneFrequencies = {};

        for (const {airplane, frequency} of link.assignedAirplanes) {
            airplaneFrequencies[airplane.id] = frequency;
        }

        // See "getLinkStaffingInfo" in main code to understand where this comes from:
        const result = await _request(`airlines/${activeAirline.id}/link-overtime-compensation`, 'POST', {
            fromAirportId : link.fromAirportId,
            toAirportId : link.toAirportId,
            airplanes : airplaneFrequencies,
            airlineId: activeAirline.id,
            price: {
                economy: link.price.economy,
                business: link.price.business,
                first: link.price.first,
            },
            model: link.modelId,
            rawQuality: link.rawQuality * 20,
            assignedDelegates: 0,
        })

        return result;
    }

    function _updateChartOptionsIfNeeded() {
        if (document.querySelector('#linkDetails fieldset .switch #switchYear')) {
            return
        }

        document.querySelector('#linkDetails fieldset .switch').parentElement.innerHTML = `
            <div class="switch" style="float: right; width: 160px;margin-right: 16px;">
                <input type="radio" class="switch-input" name="view" value="week" id="switchWeek">
                <label for="switchWeek" class="switch-label switch-label-off">Week</label>
                <input type="radio" class="switch-input" name="view" value="month" id="switchMonth">
                <label for="switchMonth" class="switch-label switch-label-on">Month</label>
                <input type="radio" class="switch-input" name="view" value="quarter" id="switchQuarter">
                <label for="switchQuarter" class="switch-label switch-label-on">Qtr</label>
                <input type="radio" class="switch-input" name="view" value="year" id="switchYear">
                <label for="switchYear" class="switch-label switch-label-on">Year</label>
                <span class="switch-selection"></span>
            </div>`;
        const selectedDuration = localStorage.getItem("linkChartCheckedDuration")
        document.getElementById(selectedDuration !== null ? selectedDuration : "switchQuarter").checked = true;

        document.querySelector('#linkDetails fieldset').setAttribute('onchange','refreshLinkCharts($(this))'); // Keep $(this) as it's passed to another function

         document.head.insertAdjacentHTML('beforeend', `<style>
        /* Added by BetterAirlineClub plugin */
        .switch-input#switchQuarter:checked + .switch-label-on ~ .switch-selection { left: 80px; }
        .switch-input#switchYear:checked + .switch-label-on ~ .switch-selection { left: 120px; }
        </style>`);
    }


    unsafeWindow.refreshLinkCharts = async function refreshLinkCharts(parentEl) {
        var _checkedElem = document.querySelector('#linkDetails fieldset .switch input:checked');
        localStorage.setItem("linkChartCheckedDuration", _checkedElem.id);

        document.querySelectorAll('#linkDetails fieldset .switch input').forEach((childElem) => {
            const same = childElem === _checkedElem;
            childElem.checked = same;
        });

        unsafeWindow.plotUnit = plotUnit = plotUnitEnum[_checkedElem.value.toUpperCase() || 'MONTH'];

        var cycleCount = plotUnit.maxWeek
        const actionLinkId = document.getElementById("actionLinkId").value;
        const linkConsumptions = await _request(`airlines/${activeAirline.id}/link-consumptions/${actionLinkId}?cycleCount=${cycleCount}`);

        plotLinkCharts(linkConsumptions, plotUnit)
        document.getElementById("linkHistoryDetails").style.display = '';
    }

    unsafeWindow.plotLinkCharts = function plotLinkCharts(linkConsumptions, plotUnit = _getPlotUnit()) {
        // Keeping FusionCharts plugin specific calls as is
        plotLinkProfit(linkConsumptions, $("#linkProfitChart"), plotUnit)
        plotLinkConsumption(linkConsumptions, $("#linkRidershipChart"), $("#linkRevenueChart"), $("#linkPriceChart"), plotUnit)
    }

    unsafeWindow.plotLinkConsumption = function plotLinkConsumption(linkConsumptions, ridershipContainer, revenueContainer, priceContainer, plotUnit) {
        // Keeping FusionCharts plugin specific calls as is
        ridershipContainer.children(':FusionCharts').each(function(i) { $(this)[0].dispose() });
        revenueContainer.children(':FusionCharts').each(function(i) { $(this)[0].dispose() });
        priceContainer.children(':FusionCharts').each(function(i) { $(this)[0].dispose() });

        var emptySeatsData = []
        var cancelledSeatsData = []
        var soldSeatsData = {
            economy : [],
            business : [],
            first : [],
        };

        var revenueByClass = {
            economy : [],
            business : [],
            first : [],
        };

        var priceByClass = {
            economy : [],
            business : [],
            first : [],
        };

        var category = []

        if (plotUnit === undefined) {
            plotUnit = plotUnitEnum.MONTH
        }

        var maxWeek = plotUnit.maxWeek
        var weeksPerMark = plotUnit.weeksPerMark
        var xLabel
        switch (plotUnit.value) {
          case plotUnitEnum.MONTH.value:
            xLabel = 'Month'
            break;
          case plotUnitEnum.QUARTER.value:
            xLabel = 'Quarter'
            break;
          case plotUnitEnum.YEAR.value:
            xLabel = 'Year'
            break;
          case plotUnitEnum.WEEK.value:
            xLabel = 'Week'
            break;
        }


        if (Object.keys(linkConsumptions).length !== 0) { // Replaced jQuery.isEmptyObject
            linkConsumptions = Array.from(linkConsumptions).slice(0, maxWeek) // Replaced $(...).toArray()
            var hasCapacity = {} //check if there's any capacity for this link class at all
            hasCapacity.economy = linkConsumptions.filter((entry) => entry.capacity.economy > 0).length !== 0; // Replaced $.grep
            hasCapacity.business = linkConsumptions.filter((entry) => entry.capacity.business > 0).length !== 0; // Replaced $.grep
            hasCapacity.first = linkConsumptions.filter((entry) => entry.capacity.first > 0).length !== 0; // Replaced $.grep

            linkConsumptions.reverse().forEach(function(linkConsumption) { // Replaced $.each
                var capacity = linkConsumption.capacity.economy + linkConsumption.capacity.business + linkConsumption.capacity.first
                var soldSeats = linkConsumption.soldSeats.economy + linkConsumption.soldSeats.business + linkConsumption.soldSeats.first
                var cancelledSeats = linkConsumption.cancelledSeats.economy + linkConsumption.cancelledSeats.business + linkConsumption.cancelledSeats.first
                emptySeatsData.push({ value : capacity - soldSeats - cancelledSeats  })
                cancelledSeatsData.push({ value : cancelledSeats  })

                soldSeatsData.economy.push({ value : linkConsumption.soldSeats.economy })
                soldSeatsData.business.push({ value : linkConsumption.soldSeats.business })
                soldSeatsData.first.push({ value : linkConsumption.soldSeats.first })

                revenueByClass.economy.push({ value : linkConsumption.price.economy * linkConsumption.soldSeats.economy })
                revenueByClass.business.push({ value : linkConsumption.price.business * linkConsumption.soldSeats.business })
                revenueByClass.first.push({ value : linkConsumption.price.first * linkConsumption.soldSeats.first })

                if (hasCapacity.economy) {
                    priceByClass.economy.push({ value : linkConsumption.price.economy })
                }
                if (hasCapacity.business) {
                    priceByClass.business.push({ value : linkConsumption.price.business })
                }
                if (hasCapacity.first) {
                    priceByClass.first.push({ value : linkConsumption.price.first })
                }

                var mark = Math.floor(linkConsumption.cycle / weeksPerMark)
                //var week = linkConsumption.cycle % 4 + 1
                category.push({ label : mark.toString()})
            })
        }

        var chartConfig = {
            xAxisname: xLabel,
            YAxisName: "Seats Consumption",
            //sYAxisName: "Load Factor %",
            sNumberSuffix: "%",
            sYAxisMaxValue: "100",
            transposeAxis: "1",
            useroundedges: "1",
            animation: "0",
            showBorder: "0",
            toolTipBorderRadius: "2",
            toolTipPadding: "5",
            plotBorderAlpha: "10",
            usePlotGradientColor: "0",
            paletteColors: "#007849,#0375b4,#ffce00,#D46A6A,#bbbbbb",
            bgAlpha: "0",
            showValues: "0",
            canvasPadding: "0",
            labelDisplay: "wrap",
            labelStep: weeksPerMark
        }

        checkDarkTheme(chartConfig, true)

        // Keeping FusionCharts plugin specific calls as is
        var ridershipChart = ridershipContainer.insertFusionCharts({
            type: 'stackedarea2d',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity: '0',
            dataSource: {
                "chart": chartConfig,
                "categories": [{
                    "category": category
                }],
                "dataset": [{
                    seriesName: "Sold Seats (Economy)",
                    data: soldSeatsData.economy
                }, {
                    seriesName: "Sold Seats (Business)",
                    data: soldSeatsData.business
                }, {
                    seriesName: "Sold Seats (First)",
                    data: soldSeatsData.first
                }, {
                    seriesName: "Cancelled Seats",
                    data: cancelledSeatsData
                }, {
                    seriesName: "Empty Seats",
                    data: emptySeatsData
                }
                //, {"seriesName": "Load Factor", "renderAs" : "line", "parentYAxis": "S", "data" : loadFactorData}
                ]
            }
        })

        chartConfig = {
            xAxisname: xLabel,
            YAxisName: "Revenue",
            //sYAxisName: "Load Factor %",
            sYAxisMaxValue: "100",
            transposeAxis:"1",
            useroundedges: "1",
            numberPrefix: "$",
            animation: "0",
            showBorder: "0",
            toolTipBorderRadius: "2",
            toolTipPadding: "5",
            plotBorderAlpha: "10",
            usePlotGradientColor: "0",
            paletteColors: "#007849,#0375b4,#ffce00",
            bgAlpha:"0",
            showValues:"0",
            canvasPadding:"0",
            labelDisplay:"wrap",
            labelStep: weeksPerMark,
        };

        checkDarkTheme(chartConfig, true)

        // Keeping FusionCharts plugin specific calls as is
        var revenueChart = revenueContainer.insertFusionCharts( {
            type: 'stackedarea2d',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity :'0',
            dataSource: {
                "chart": chartConfig,
                "categories" : [{ "category" : category}],
                "dataset": [{
                    "seriesName": "Revenue (Economy)",
                    "data": revenueByClass.economy
                }, {
                    "seriesName": "Revenue (Business)",
                    "data": revenueByClass.business
                }, {
                    "seriesName": "Revenue (First)",
                    "data": revenueByClass.first
                }]
            }
        })

        chartConfig = {
            "xAxisname": xLabel,
            "YAxisName": "Ticket Price",
            //"sYAxisName": "Load Factor %",
            "numberPrefix": "$",
            "sYAxisMaxValue": "100",
            "useroundedges": "1",
            "transposeAxis": "1",
            "animation": "0",
            "showBorder": "0",
            "drawAnchors": "0",
            "toolTipBorderRadius": "2",
            "toolTipPadding": "5",
            "paletteColors": "#007849,#0375b4,#ffce00",
            "bgAlpha": "0",
            "showValues": "0",
            "canvasPadding": "0",
            "formatNumberScale": "0",
            "labelDisplay": "wrap",
            "labelStep": weeksPerMark
        }

        checkDarkTheme(chartConfig, true)

        // Keeping FusionCharts plugin specific calls as is
        var priceChart = priceContainer.insertFusionCharts({
            type: 'msline',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity: '0',
            dataSource: {
                "chart": chartConfig,
                "categories": [{
                    "category": category
                }],
                "dataset": [{
                    "seriesName": "Price (Economy)",
                    "data": priceByClass.economy,
                }, {
                    "seriesName": "Price (Business)",
                    "data": priceByClass.business,
                }, {
                    "seriesName": "Price (First)",
                    "data": priceByClass.first,
                }]
            }
        })
    }

    function plotLinkProfit(linkConsumptions, container, plotUnit) {
        // Keeping FusionCharts plugin specific calls as is
        container.children(':FusionCharts').each((function(i) {
              $(this)[0].dispose();
        }))

        var data = []
        var category = []

        var profitByMark = {}
        var markOrder = []

        if (plotUnit === undefined) {
            plotUnit = plotUnitEnum.MONTH
        }

        var maxMark = plotUnit.maxMark
        var xLabel
        var yLabel
        var weeksPerMark = plotUnit.weeksPerMark
        switch (plotUnit.value) {
            case plotUnitEnum.MONTH.value:
                xLabel = 'Month'
                yLabel = 'Monthly Profit'
                break;
            case plotUnitEnum.QUARTER.value:
                xLabel = 'Quarter'
                yLabel = 'Quarterly Profit'
                break;
            case plotUnitEnum.YEAR.value:
                xLabel = 'Year'
                yLabel = 'Yearly Profit'
                break;
            case plotUnitEnum.WEEK.value:
                xLabel = 'Week'
                yLabel = 'Weekly Profit'
                break;
        }

        linkConsumptions.forEach(function(linkConsumption) { // Replaced $.each
            //group in months first
            var mark = Math.floor(linkConsumption.cycle / weeksPerMark)
            if (profitByMark[mark] === undefined) {
                profitByMark[mark] = linkConsumption.profit
                markOrder.push(mark)
            } else {
                profitByMark[mark] += linkConsumption.profit
            }
        })


        markOrder = markOrder.slice(0, maxMark)
        markOrder.reverse().forEach(function(mark) { // Replaced $.each
            data.push({ value : profitByMark[mark] })
            category.push({ label : mark.toString() })
        })

        var chartConfig = {
                            "xAxisname": xLabel,
                            "yAxisName": yLabel,
                            "numberPrefix": "$",
                            "useroundedges": "1",
                            "animation": "0",
                            "showBorder":"0",
                            "showPlotBorder":"0",
                            "toolTipBorderRadius": "2",
                            "toolTipPadding": "5",
                            "bgAlpha": "0",
                            "showValues":"0"
                            }

        checkDarkTheme(chartConfig)

        // Keeping FusionCharts plugin specific calls as is
        var chart = container.insertFusionCharts({
            type: 'mscombi2d',
            width: '100%',
            height: '100%',
            containerBackgroundOpacity :'0',
            dataFormat: 'json',
            dataSource: {
                "chart": chartConfig,
                "categories" : [{ "category" : category}],
                "dataset" : [ {"data" : data}, {"renderas" : "Line", "data" : data} ]

            }
        })
    }

    // For "Flight Research" screen
    document.querySelector('#researchSearchResult > div.table.data.links').insertAdjacentHTML('afterend', `
        <select class="select-css" id="researchFlightModelSelect" onchange="researchUpdateModelInfo(this.value)" style="margin: 10px auto; float: middle; display: block;"></select>
        <div id="researchExtendedPanel" class="section" style="width: 70%; margin: 10px auto;">
            <div id="researchAirplaneModelDetails" style="width: 100%;" class="active">
                <div class="table">
                    <h4>Airplane Model Details</h4>
                    <div class="table-row">
                        <div class="label"><h5>Model:</h5></div>
                        <div class="value" id="modelName"></div>
                    </div>
                    <div id="cpp-costs-container">
                        <!-- Cost details will be injected here by researchUpdateModelInfo -->
                    </div>
                    <div class="table-row">
                        <div class="label"><h5>Max Lifespan:</h5></div>
                        <div class="value" id="lifespan"></div>
                    </div>
                    <div class="table-row">
                        <div class="label"><h5>Manufacturer:</h5></div>
                        <div class="value manufacturer"></div>
                    </div>
                    <div class="table-row">
                        <div class="label"><h5>Purchase Price:</h5></div>
                        <div class="value price"></div>
                    </div>
                    <div class="table-row">
                        <div class="label"><h5>Delivery Time:</h5></div>
                        <div class="value delivery warning"></div>
                    </div>
                    <div class="button add" onclick="promptBuyNewAirplane($('#researchAirplaneModelDetails .selectedModel').val(), true, activeAirline.headquarterAirport.airportId)">Place Order</div>
                    <div class="button" onclick="showAirplaneBaseFromPlanLink($('#researchAirplaneModelDetails .selectedModel').val())">Base</div>
                    <div class="button" onclick="showAirplaneModelConfigurationsFromPlanLink($('#researchAirplaneModelDetails .selectedModel').val())">Config</div>
                    <input type="hidden" class="selectedModel" value="">
                </div>
            </div>
        </div>
    `);

    // For "Link Planning / Edit Link" screen
    document.querySelector("#airplaneModelDetails > div").insertAdjacentHTML('beforebegin', `<select class="select-css" id="viewLinkModelSelect" onchange="linkUpdateModelInfo(this.value)" style="margin: 10px auto; float: middle; display: none;"></select>`);

    _updateChartOptionsIfNeeded();
    _updateLatestOilPriceInHeader();
};

document.addEventListener('DOMContentLoaded', () => setTimeout(() => launch(), 1000)); // Replaced $(document).ready()


// Begin Cost per PAX
console.log("Plane score script loading");

function calcFlightTime(plane, distance){
    let min = Math.min;
    let max = Math.max;
    let speed = plane.speed * (plane.airplaneType.toUpperCase() == "SUPERSONIC" ? 1.5 : 1);
    let a = min(distance, 300);
    let b = min(max(0, distance-a), 400);
    let c = min(max(0, distance-(a+b)), 400);
    let d = max(0, distance-(a+b+c));

    let time_flight = a / min(speed, 350) + b / min(speed, 500) + c / min(speed, 700) + d / speed;
    return time_flight * 60;
}

function calcFuelBurn(plane, distance){
    let timeFlight = calcFlightTime(plane, distance);
    if (timeFlight > 1.5){
        return plane.fuelBurn * (495 + timeFlight);
    } else {
        return plane.fuelBurn * timeFlight * 5.5;
    }
}

function _getPlaneCategoryFor(plane) {
    switch (plane.airplaneType.toUpperCase()) {
        case 'LIGHT':
        case 'SMALL':
            return 1;
        case 'REGIONAL':
            return 3;
        case 'MEDIUM':
            return 8;
        case 'LARGE':
            return 12;
        case 'EXTRA LARGE':
        case 'X_LARGE':
            return 15;
        case 'JUMBO':
            return 18;
        case 'SUPERSONIC':
            return 12;
    }
    console.error(`BAC+CPP:Error:: Cannot get category for plane ${JSON.stringify(plane)}`)
}

let initialAirplaneModelStatsLoading = true;

unsafeWindow.updateAirplaneModelTable = function(sortProperty, sortOrder) {
    let distance = parseInt(document.getElementById("flightRange").value, 10);
    let runway = parseInt(document.getElementById("runway").value, 10);
    let min_capacity = parseInt(document.getElementById("min_capacity").value, 10);
    let min_circulation = parseInt(document.getElementById("min_circulation").value, 10);

    let owned_only = document.getElementById("owned_only").checked;
    let use_flight_total =document.getElementById("use_flight_total").checked;

    for (let plane of loadedModelsOwnerInfo) {
        plane.isOwned = ((plane.assignedAirplanes.length + plane.availableAirplanes.length + plane.constructingAirplanes.length) !== 0);

        if(plane.range < distance || plane.runwayRequirement > runway) {
            plane.cpp = -1;
            plane.max_rotation = -1;
            //continue;
        }
        var plane_category = _getPlaneCategoryFor(plane);
        let flightDuration = calcFlightTime(plane, distance) ;
        let price = plane.price;
        if( plane.originalPrice){
            price = plane.originalPrice;
        }

        let maxFlightMinutes = 4 * 24 * 60;
        let frequency = Math.floor(maxFlightMinutes / ((flightDuration + plane.turnaroundTime)*2));

        let flightTime = frequency * 2 * (flightDuration + plane.turnaroundTime);
        let availableFlightMinutes = maxFlightMinutes - flightTime;
        let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
        let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

        let decayRate = 100 / (plane.lifespan * 3) * (1 + 2 * planeUtilisation);
        let depreciationRate = Math.floor(price * (decayRate / 100) * utilisation);
        let maintenance = plane.capacity * 100 * utilisation;

        let airport_fee = (500 * plane_category + plane.capacity * 10) * 2;
        let crew_cost = plane.capacity * (flightDuration / 60) * 12 ;
        let inflight_cost = (20 + 8 * flightDuration / 60) * plane.capacity * 2;

        plane.max_rotation = frequency;
        plane.fbpf = calcFuelBurn(plane, distance);
        plane.fbpp = plane.fbpf / plane.capacity;
        plane.fbpw = plane.fbpf * plane.max_rotation;
        plane.fuel_total = ((plane.fbpf * 0.08 + airport_fee + inflight_cost + crew_cost) * plane.max_rotation + depreciationRate + maintenance);
        plane.cpp = plane.fuel_total / (plane.capacity * plane.max_rotation);
        plane.max_capacity = plane.capacity * plane.max_rotation;

        plane.discountPercent = (plane.originalPrice) ? Math.round(100 - (plane.price / plane.originalPrice * 100)) : 0;

        if (!plane.in_use) {
            plane.in_use = -1;
            loadAirplaneModelStats(plane, {totalOnly: true}).then(() => {
                // This could probably be in a debounce but I'm cool with this for a final reload once stats are done.
                if (!initialAirplaneModelStatsLoading) {
                    return;
                }
                if (unsafeWindow.cachedTotalsById && Object.keys(unsafeWindow.cachedTotalsById).length === loadedModelsOwnerInfo.length) {
                    initialAirplaneModelStatsLoading = false;
                    updateAirplaneModelTable();
                }
            });
        }

        plane.shouldShow = ((plane.cpp === -1)
           || (plane.max_capacity < min_capacity)
           || (plane.range < distance)
           || (plane.runwayRequirement > runway)
           || (plane.in_use < min_circulation && !plane.isOwned)
           || (owned_only && !plane.isOwned)) === false;
    }

    if (!sortProperty && !sortOrder) {
        var selectedSortHeader = document.querySelector('#airplaneModelSortHeader .cell.selected');
        sortProperty = selectedSortHeader.dataset.sortProperty;
        if (sortProperty === 'capacity') {
            sortProperty = 'max_capacity';
        } else if (sortProperty === 'cpp' && use_flight_total) {
            sortProperty = 'fuel_total';
        }
        sortOrder = selectedSortHeader.dataset.sortOrder;
    }
    //sort the list
    loadedModelsOwnerInfo.sort(sortByProperty(sortProperty, sortOrder == "ascending"));

    var airplaneModelTable = document.getElementById("airplaneModelTable");
    airplaneModelTable.querySelectorAll("div.table-row").forEach(el => el.remove());

    var cppValues = loadedModelsOwnerInfo.filter(l => l.shouldShow).map(l => l.cpp);
    var cppMax = Math.max(...cppValues);
    var cppMin = Math.max(Math.min(...cppValues), 0);

    loadedModelsOwnerInfo.forEach(function(modelOwnerInfo) { // Replaced $.each
        if (!modelOwnerInfo.shouldShow) {
            return;
        }

        var row = document.createElement('div');
        row.className = 'table-row clickable';
        row.style.cssText = (modelOwnerInfo.isOwned ? "background: green;" : '');
        row.dataset.modelId = modelOwnerInfo.id;
        row.setAttribute('onclick', 'selectAirplaneModel(loadedModelsById[' + modelOwnerInfo.id + '])');

        if (modelOwnerInfo.isFavorite) {
            row.insertAdjacentHTML('beforeend', "<div class='cell'>" + modelOwnerInfo.name + "<img src='assets/images/icons/heart.png' height='10px'></div>");
        } else {
            row.insertAdjacentHTML('beforeend', "<div class='cell'>" + modelOwnerInfo.name + "</div>");
        }
        row.insertAdjacentHTML('beforeend', "<div class='cell' style='text-overflow: ellipsis;text-wrap: nowrap;overflow: clip;' title='"+modelOwnerInfo.family+"'>" + modelOwnerInfo.family + "</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + commaSeparateNumber(modelOwnerInfo.price) + "</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.capacity + " (" + (modelOwnerInfo.capacity * modelOwnerInfo.max_rotation) + ")</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.range + " km</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.fuelBurn + "</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.lifespan / 52 + " yrs</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.speed + " km/h</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.runwayRequirement + " m</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.assignedAirplanes.length + "/" + modelOwnerInfo.availableAirplanes.length + "/" + modelOwnerInfo.constructingAirplanes.length + "</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right'>" + modelOwnerInfo.max_rotation + "</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right' style='"+ getStyleFromTier(getTierFromPercent(-1*modelOwnerInfo.cpp, -1*cppMax, -1*cppMin)) +"' title='"+commaSeparateNumber(Math.round(modelOwnerInfo.fuel_total))+"/total ("+commaSeparateNumber(Math.round(modelOwnerInfo.cpp * modelOwnerInfo.capacity))+"/flight)'>" + commaSeparateNumber(Math.round(modelOwnerInfo.cpp)) + "</div>");

        let discountTier;
        if (modelOwnerInfo.discountPercent > 40) {
            discountTier = 0;
        } else if (modelOwnerInfo.discountPercent > 10) {
            discountTier = 1;
        } else if (modelOwnerInfo.discountPercent > 0) {
            discountTier = 2;
        } else {
            discountTier = 3;
        }
        row.insertAdjacentHTML('beforeend', "<div class='cell' align='right' style='"+ getStyleFromTier(discountTier) +"' >" + modelOwnerInfo.discountPercent + "</div>");
        row.insertAdjacentHTML('beforeend', "<div class='cell' style='"+ (modelOwnerInfo.in_use >= MIN_PLANES_TO_HIGHLIGHT ? "text-shadow: gold 0px 0px 3px;" : '') +"'  align='right'>" + modelOwnerInfo.in_use + "</div>");


        if (selectedModelId == modelOwnerInfo.id) {
            row.classList.add("selected")
            selectAirplaneModel(modelOwnerInfo)
        }
        airplaneModelTable.appendChild(row)
    });
}

const columnWidthPercents = [
    17,
    9,
    8,
    7,
    7,
    7,
    7,
    9,
    7,
    6,
    3,
    5,
    4,
    4
];

if (columnWidthPercents.reduce((sum, val) => sum += val, 0) !== 100) {
    console.warn('Column widths do not equal 100%, widths:', columnWidthPercents);
}


document.getElementById("airplaneModelSortHeader").insertAdjacentHTML('beforeend', "<div class=\"cell clickable\" title=\"Max flight rotations (uses user-set distance above)\" data-sort-property=\"max_rotation\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">⏲</div>");
document.getElementById("airplaneModelSortHeader").insertAdjacentHTML('beforeend', "<div class=\"cell clickable\" title=\"Cost Per Pax\" data-sort-property=\"cpp\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">$/🧍</div>");
document.getElementById("airplaneModelSortHeader").insertAdjacentHTML('beforeend', "<div class=\"cell clickable\" title=\"Discount Percent (influcenced by demand & brand loyalties)\" data-sort-property=\"discountPercent\" data-sort-order=\"descending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">%🔽</div>");
document.getElementById("airplaneModelSortHeader").insertAdjacentHTML('beforeend', "<div class=\"cell clickable\" title=\"Total number in circulation (all players, game wide)\" data-sort-property=\"in_use\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">#✈</div>");

const headerCells = document.querySelectorAll('#airplaneModelSortHeader .cell');
for (var i = 0; i < headerCells.length; i++) {
    headerCells[i].style.width = `${columnWidthPercents[i]}%`;
}

document.querySelector('#airplaneModelTable .table-header').innerHTML = `
    <div class="cell" style="width: ${columnWidthPercents[0]}%; border-bottom: none;"></div>
    <div class="cell" style="width: ${columnWidthPercents[1]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[2]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[3]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[4]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[5]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[6]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[7]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[8]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[9]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[10]}%; border-bottom: none;"></div><!-- New columns -->
    <div class="cell" style="width:  ${columnWidthPercents[11]}%; border-bottom: none;"></div><!-- New columns -->
    <div class="cell" style="width:  ${columnWidthPercents[12]}%; border-bottom: none;"></div><!-- New columns -->
    <div class="cell" style="width:  ${columnWidthPercents[13]}%; border-bottom: none;"></div><!-- New columns -->
`;

document.querySelector("#airplaneCanvas .mainPanel .section .table .table-header:first").insertAdjacentHTML('beforeend', `
    <div class="cell detailsSelection">Distance: <input type="text" id="flightRange" value="${DEFAULT_MIN_FLIGHT_RANGE_FILTER}" /></div>
    <div class="cell detailsSelection">Runway length: <input type="text" id="runway" value="${DEFAULT_RUNWAY_LENGTH_FILTER}" /></div>
    <div class="cell detailsSelection">Min. Capacity: <input type="text" id="min_capacity" value="${DEFAULT_MIN_CAPACITY_FILTER}" /></div>
    <div class="cell detailsSelection">Min. Circulation: <input type="text" id="min_circulation" value="${DEFAULT_MIN_PLANES_IN_CIRCULATION_FILTER}" /></div>
    <div class="cell detailsSelection" style="min-width: 160px; text-align:right">
        <label for="owned_only">Owned Only <input type="checkbox" id="owned_only" /></label>
        <label for="use_flight_total">Flight Fuel Total <input type="checkbox" id="use_flight_total" /></label>
    </div>
`);


document.querySelector("#airplaneCanvas .mainPanel .section .detailsGroup .market.details").style.cssText = 'width: 100%; height: calc(100% - 30px); display: block;';

document.querySelector('[data-sort-property="totalOwned"]').textContent = 'Owned';
document.querySelector('[data-sort-property="totalOwned"]').style.width = '6%';


var newDataFilterElements = [
    '#flightRange',
    '#runway',
    '#min_capacity',
    '#min_circulation',
    '#owned_only',
    '#use_flight_total',
]

for (var el of newDataFilterElements) {
    document.querySelector(el).addEventListener('change', function(){unsafeWindow.updateAirplaneModelTable()});
}

//* Link Cost Preview

let _updatePlanLinkInfo = unsafeWindow.updatePlanLinkInfo;
let _updateTotalValues = unsafeWindow.updateTotalValues;

unsafeWindow.latestActiveLink = null;

let activeLink;
let idFrom = -1;
let idTo = -1;
let airportFrom;
let airportTo;
let _modelId = -1;

let observer = new MutationObserver(function(mutations) {
    updateModelInfo(_modelId);
});

observer.observe(
    document.getElementById('planLinkServiceLevel'), {
        attributes: true,
        attributeFilter: ['value']
    }
);

unsafeWindow.updateTotalValues = function(){
    _updateTotalValues();
    unsafeWindow.updateModelInfo(_modelId);
}

unsafeWindow.updatePlanLinkInfo = function(linkInfo){
    //console.log(linkInfo);
    unsafeWindow.latestActiveLink = activeLink = linkInfo;

    for (let model of activeLink.modelPlanLinkInfo){
        for (let airplane of model.airplanes){
            airplane.airplane.frequency = airplane.frequency;
        }
    }

    airportFrom = airports.find(a => a.id == linkInfo.fromAirportId)
    airportTo = airports.find(a => a.id == linkInfo.toAirportId)

    _updatePlanLinkInfo(linkInfo);
}

let _updateModelInfo = unsafeWindow.updateModelInfo;

unsafeWindow.updateModelInfo = function(modelId) {
    if (_modelId != modelId){
        _updateModelInfo(modelId);
    }
    _modelId = modelId;

    let model = loadedModelsById[modelId];
    let linkModel = activeLink.modelPlanLinkInfo.find(plane => plane.modelId == modelId);

    //console.log({loadedModelsById, model, linkModel})
    let serviceLevel = parseInt(document.getElementById("planLinkServiceLevel").value);
    let frequency = 0;

    let plane_category = _getPlaneCategoryFor(model);

    let baseSlotFee = 0;

    switch (airportFrom.size){
        case 1 :
        case 2 : baseSlotFee=50;break;
        case 3 : baseSlotFee=80;break;
        case 4 : baseSlotFee=150;break;
        case 5 : baseSlotFee=250;break;
        case 6 : baseSlotFee=350;break;
        default: baseSlotFee=500;break;
    }

    switch (airportTo.size){
        case 1 :
        case 2 : baseSlotFee+=50;break;
        case 3 : baseSlotFee+=80;break;
        case 4 : baseSlotFee+=150;break;
        case 5 : baseSlotFee+=250;break;
        case 6 : baseSlotFee+=350;break;
        default: baseSlotFee+=500;break;
    }

    let serviceLevelCost = 1;

    switch (serviceLevel) {
        case 2:serviceLevelCost=4;break;
        case 3:serviceLevelCost=8;break;
        case 4:serviceLevelCost=13;break;
        case 5:serviceLevelCost=20;break;
    }

    let basic = 0;
    let multiplyFactor = 2;
    if (airportFrom.countryCode == airportTo.countryCode) {
        if (activeLink.distance <= 1000) {
            basic = 8;
        } else if (activeLink.distance <= 3000) {
            basic = 10;
        } else {
            basic = 12;
        }
    } else if (airportFrom.zone == airportTo.zone){
        if (activeLink.distance <= 2000) {
            basic = 10;
        } else if (activeLink.distance <= 4000) {
            basic = 15;
        } else {
            basic = 20;
        }
    } else {
        if (activeLink.distance <= 2000) {
            basic = 15;
            multiplyFactor = 3;
        } else if (activeLink.distance <= 5000) {
            basic = 25;
            multiplyFactor = 3;
        } else if (activeLink.distance <= 12000) {
            basic = 30;
            multiplyFactor = 4;
        } else {
            basic = 30;
            multiplyFactor = 4;
        }
    }

    let staffPerFrequency = multiplyFactor * 0.4;
    let staffPer1000Pax = multiplyFactor;


    let durationInHour = linkModel.duration / 60;

    let price = model.price;
    if( model.originalPrice){
        price = model.originalPrice;
    }
    let baseDecayRate = 100 / model.lifespan;

    let maintenance = 0;
    let depreciationRate = 0;

    document.querySelectorAll(".frequencyDetail .airplaneRow").forEach(function(row) { // Replaced jQuery selector and iteration
        let airplane = $(row).data("airplane"); // Keep .data()
        let freq = parseInt(row.querySelector(".frequency").value); // Replaced .children(".frequency").val()
        let futureFreq = freq - airplane.frequency;
        let flightTime = freq * 2 * (linkModel.duration + model.turnaroundTime);

        let availableFlightMinutes = airplane.availableFlightMinutes - (futureFreq * 2 * (linkModel.duration + model.turnaroundTime));

        let utilisation = flightTime / (airplane.maxFlightMinutes - availableFlightMinutes);
        let planeUtilisation = (airplane.maxFlightMinutes - availableFlightMinutes) / airplane.maxFlightMinutes;

        let decayRate = 100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation);

        depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);

        maintenance += model.capacity * 100 * utilisation;

        frequency += freq;
    });

    if (frequency == 0){
        let maxFlightMinutes = 4 * 24 * 60;
        frequency = Math.floor(maxFlightMinutes / ((linkModel.duration + model.turnaroundTime)*2));

        let flightTime = frequency * 2 * (linkModel.duration + model.turnaroundTime);
        let availableFlightMinutes = maxFlightMinutes - flightTime;
        let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
        let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

        let decayRate = 100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation);
        depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);
        maintenance += model.capacity * 100 * utilisation;
    }

    let fuelCost = frequency;

    if (linkModel.duration <= 90){
        fuelCost *= model.fuelBurn * linkModel.duration * 5.5 * 0.08;
    }else{
        fuelCost *= model.fuelBurn * (linkModel.duration + 495) * 0.08;
    }

    let crewCost = model.capacity * durationInHour * 12 * frequency;
    let airportFees = (baseSlotFee * plane_category + (Math.min(3, airportTo.size) + Math.min(3, airportFrom.size)) * model.capacity) * frequency;
    let servicesCost = (20 + serviceLevelCost * durationInHour) * model.capacity * 2 * frequency;
    let cost = fuelCost + crewCost + airportFees + depreciationRate + servicesCost + maintenance;

    let staffTotal = Math.floor(basic + staffPerFrequency * frequency + staffPer1000Pax * model.capacity * frequency / 1000);

    document.getElementById('FCPF').textContent = "$" + commaSeparateNumber(Math.floor(fuelCost));
    document.getElementById('CCPF').textContent = "$" + commaSeparateNumber(Math.floor(crewCost));
    document.getElementById('AFPF').textContent = "$" + commaSeparateNumber(airportFees);
    document.getElementById('depreciation').textContent = "$" + commaSeparateNumber(Math.floor(depreciationRate));
    document.getElementById('SSPF').textContent = "$" + commaSeparateNumber(Math.floor(servicesCost));
    document.getElementById('maintenance').textContent = "$" + commaSeparateNumber(Math.floor(maintenance));
    document.getElementById('cpp').textContent = "$" + commaSeparateNumber(Math.floor(cost / (model.capacity * frequency))) + " * " + (model.capacity * frequency);
    document.getElementById('cps').textContent = "$" + commaSeparateNumber(Math.floor(cost / staffTotal)) + " * " + staffTotal;
}

document.getElementById("speed").parentElement.insertAdjacentHTML('afterend', `
<div class="table-row">
    <div class="label">&#8205;</div>
</div>
<div class="table-row">
    <div class="label">
        <h5>--  Costs  --</h5>
    </div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Fuel cost:</h5>
    </div>
    <div class="value" id="FCPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Crew cost:</h5>
    </div>
    <div class="value" id="CCPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Airport fees:</h5>
    </div>
    <div class="value" id="AFPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Depreciation (wip):</h5>
    </div>
    <div class="value" id="depreciation"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Service supplies:</h5>
    </div>
    <div class="value" id="SSPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Maintenance (wip):</h5>
    </div>
    <div class="value" id="maintenance"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Cost per PAX:</h5>
    </div>
    <div class="value" id="cpp"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Cost per staff:</h5>
    </div>
    <div class="value" id="cps"></div>
</div>
<div class="table-row">
    <div class="label">&#8205;</div>
</div>`);

unsafeWindow.researchFlight = async function researchFlight(fromAirportId, toAirportId) {
    if (fromAirportId && toAirportId) {
        document.querySelector('body .loadingSpinner').style.display = '';
        const result = await _request("research-link/" + fromAirportId + "/" + toAirportId).finally(() => document.querySelector('body .loadingSpinner').style.display = 'none');

        $("#searchCanvas").data(result); // Keep .data()
        var fromAirport = result.fromAirport;
        var toAirport = result.toAirport;
        loadAirportImage(fromAirport.id, document.querySelector('#researchSearchResult img.fromAirport'));
        loadAirportImage(toAirport.id, document.querySelector('#researchSearchResult img.toAirport'));
        document.querySelector("#researchSearchResult .fromAirportText").textContent = result.fromAirportText;
        document.querySelector("#researchSearchResult .fromAirportText").setAttribute("onclick", `showAirportDetails(${fromAirport.id})`);
        document.querySelector("#researchSearchResult .fromAirport .population").textContent = commaSeparateNumber(result.fromAirport.population);
        document.querySelector("#researchSearchResult .fromAirport .incomeLevel").textContent = result.fromAirport.incomeLevel;
        document.querySelector("#researchSearchResult .toAirportText").textContent = result.toAirportText;
        document.querySelector("#researchSearchResult .toAirportText").setAttribute("onclick", `showAirportDetails(${toAirport.id})`);
        populateNavigation(document.getElementById("researchSearchResult"));
        document.querySelector("#researchSearchResult .toAirport .population").textContent = commaSeparateNumber(result.toAirport.population);
        document.querySelector("#researchSearchResult .toAirport .incomeLevel").textContent = result.toAirport.incomeLevel;
        document.querySelector("#researchSearchResult .relationship").innerHTML = getCountryFlagImg(result.fromAirport.countryCode) + "&nbsp;vs&nbsp;" + getCountryFlagImg(result.toAirport.countryCode) + getCountryRelationshipDescription(result.mutualRelationship);
        document.querySelector("#researchSearchResult .distance").textContent = result.distance;
        document.querySelector("#researchSearchResult .flightType").textContent = result.flightType;
        document.querySelector("#researchSearchResult .demand").textContent = toLinkClassValueString(result.directDemand);

        var breakdownEl = document.querySelector("#researchSearchResult .directDemandBreakdown");
        var fromAirportLabel = breakdownEl.querySelector(".fromAirport .airportLabel");
        fromAirportLabel.innerHTML = '';
        fromAirportLabel.appendChild(getAirportSpan(fromAirport));
        breakdownEl.querySelector(".fromAirport .businessDemand").textContent = toLinkClassValueString(result.fromAirportBusinessDemand);
        breakdownEl.querySelector(".fromAirport .touristDemand").textContent = toLinkClassValueString(result.fromAirportTouristDemand);
        var toAirportLabel = breakdownEl.querySelector(".toAirport .airportLabel");
        toAirportLabel.innerHTML = '';
        toAirportLabel.appendChild(getAirportSpan(toAirport));
        breakdownEl.querySelector(".toAirport .businessDemand").textContent = toLinkClassValueString(result.toAirportBusinessDemand);
        breakdownEl.querySelector(".toAirport .touristDemand").textContent = toLinkClassValueString(result.toAirportTouristDemand);

        document.querySelectorAll("#researchSearchResult .table.links .table-row").forEach(el => el.remove());
        const usedModels = [];
        result.links.forEach(function(link) { // Replaced $.each
            var row = document.createElement('div');
            row.className = 'table-row';
            row.innerHTML = `<div class='cell'>${link.airlineName}</div><div class='cell'>${link.modelName}</div><div class='cell'>${toLinkClassValueString(link.price, "$")}</div><div class='cell'>${toLinkClassValueString(link.capacity)}</div><div class='cell'>${link.computedQuality}</div><div class='cell'>${link.frequency}</div>`;
            document.querySelector('#researchSearchResult .table.links').appendChild(row);
            usedModels.push(link.modelId);
        });

        if (result.links.length == 0) {
            document.querySelector('#researchSearchResult .table.links').insertAdjacentHTML('beforeend', "<div class='table-row'><div class='cell'>-</div><div class='cell'>-</div><div class='cell'>-</div><div class='cell'>-</div><div class='cell'>-</div></div>");
        }
        assignAirlineColors(result.consumptions, "airlineId");
        plotPie(result.consumptions, null, document.querySelector("#researchSearchResult .linksPie"), "airlineName", "soldSeats");
        document.getElementById('researchSearchResult').style.display = '';

        const minRunway = Math.min(fromAirport.runwayLength, toAirport.runwayLength);
        const distance = result.distance;
        if (Object.values(loadedModelsById).length == 0) loadAirplaneModels();

        var arrayModels = Object.values(loadedModelsById).map(model => ({ ...model, used: usedModels.includes(model.id) }));
        arrayModels = sortPreserveOrder(arrayModels, "used", false);

        var selectEl = document.getElementById("researchFlightModelSelect");
        selectEl.innerHTML = ''; // Replaced .empty()
        var selectedModelId = result.links.length > 0 ? result.links[0].modelId : null;
        arrayModels.forEach(function(model) { // Replaced $.each
            if (model.range >= distance && model.runwayRequirement <= minRunway) {
                if (selectedModelId === null) selectedModelId = model.id;
                let flightDuration = calcFlightTime(model, distance);
                let maxFlightMinutes = 4 * 24 * 60;
                let frequency = Math.floor(maxFlightMinutes / ((flightDuration + model.turnaroundTime) * 2));
                var option = document.createElement("option");
                option.value = model.id;
                option.textContent = model.name + " (" + frequency + ")";
                if(model.used) option.classList.add("highlight-text");
                selectEl.appendChild(option);
            }
        });
        if (selectedModelId) {
            selectEl.value = selectedModelId;
            researchUpdateModelInfo(selectedModelId);
        }
    }
}

function _genericUpdateModelInfo(modelId, routeInfo, containerSelector, serviceLevel) {
    let model = loadedModelsById[modelId];
    let containerEl = document.querySelector(containerSelector);

    containerEl.querySelector('.selectedModel').value = modelId;
    containerEl.querySelector('#modelName').textContent = model.name;
    // Basic model details
    let detailsHtml = `
        <div class="table-row"><div class="label"><h5>Family:</h5></div><div class="value modelFamily">${model.family}</div></div>
        <div class="table-row"><div class="label"><h5>Max Capacity:</h5></div><div class="value" id="capacity">${model.capacity}</div></div>
        <div class="table-row"><div class="label"><h5>Max Flying Range:</h5></div><div class="value" id="range">${model.range}km</div></div>
        <div class="table-row"><div class="label"><h5>Fuel Burn:</h5></div><div class="value" id="fuelBurn">${model.fuelBurn}</div></div>
        <div class="table-row"><div class="label"><h5>Category:</h5></div><div class="value" id="airplaneType">${model.airplaneType}</div></div>
        <div class="table-row"><div class="label"><h5>Turnaround Time:</h5></div><div class="value"><span class="turnaroundTime">${model.turnaroundTime}</span>&nbsp;min</div></div>
        <div class="table-row"><div class="label"><h5>Runway requirement:</h5></div><div class="value"><span class="runwayRequirement">${model.runwayRequirement}</span>&nbsp;m</div></div>
        <div class="table-row"><div class="label"><h5>Speed:</h5></div><div class="value" id="speed">${model.speed}km/h</div></div>
        <div class="table-row"><div class="label">&#8205;</div></div>
        <div class="table-row"><div class="label"><h5>-- Costs --</h5></div></div>`;

    // Cost calculations
    let plane_category = _getPlaneCategoryFor(model);
    let airportFrom = routeInfo.fromAirport;
    let airportTo = routeInfo.toAirport;

    let baseSlotFee = 0;
    [airportFrom, airportTo].forEach(ap => {
        switch (ap.size) {
            case 1: case 2: baseSlotFee += 50; break;
            case 3: baseSlotFee += 80; break;
            case 4: baseSlotFee += 150; break;
            case 5: baseSlotFee += 250; break;
            case 6: baseSlotFee += 350; break;
            default: baseSlotFee += 500; break;
        }
    });

    let serviceLevelCost = 1;
    switch (serviceLevel) { case 2: serviceLevelCost = 4; break; case 3: serviceLevelCost = 8; break; case 4: serviceLevelCost = 13; break; case 5: serviceLevelCost = 20; break; }

    let duration = calcFlightTime(model, routeInfo.distance);
    let durationInHour = duration / 60;
    let maxFlightMinutes = 4 * 24 * 60;
    let frequency = Math.floor(maxFlightMinutes / ((duration + model.turnaroundTime) * 2));

    let flightTime = frequency * 2 * (duration + model.turnaroundTime);
    let planeUtilisation = flightTime / maxFlightMinutes;
    let utilisation = planeUtilisation; // Simplified for this context

    let depreciationRate = Math.floor(model.price * (100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation) / 100) * utilisation);
    let maintenance = model.capacity * 100 * utilisation;
    let fuelCost = calcFuelBurn(model, routeInfo.distance) * 0.08 * frequency;
    let crewCost = model.capacity * durationInHour * 12 * frequency;
    let airportFees = (baseSlotFee * plane_category + (Math.min(3, airportTo.size) + Math.min(3, airportFrom.size)) * model.capacity) * frequency;
    let servicesCost = (20 + serviceLevelCost * durationInHour) * model.capacity * 2 * frequency;
    let totalCost = fuelCost + crewCost + airportFees + depreciationRate + servicesCost + maintenance;
    let costPerPax = totalCost / (model.capacity * frequency);

    detailsHtml += `
        <div class="table-row"><div class="label"><h5>Fuel cost:</h5></div><div class="value" id="FCPF">$${commaSeparateNumber(Math.floor(fuelCost))}</div></div>
        <div class="table-row"><div class="label"><h5>Crew cost:</h5></div><div class="value" id="CCPF">$${commaSeparateNumber(Math.floor(crewCost))}</div></div>
        <div class="table-row"><div class="label"><h5>Airport fees:</h5></div><div class="value" id="AFPF">$${commaSeparateNumber(airportFees)}</div></div>
        <div class="table-row"><div class="label"><h5>Depreciation (wip):</h5></div><div class="value" id="depreciation">$${commaSeparateNumber(Math.floor(depreciationRate))}</div></div>
        <div class="table-row"><div class="label"><h5>Service supplies:</h5></div><div class="value" id="SSPF">$${commaSeparateNumber(Math.floor(servicesCost))}</div></div>
        <div class="table-row"><div class="label"><h5>Maintenance (wip):</h5></div><div class="value" id="maintenance">$${commaSeparateNumber(Math.floor(maintenance))}</div></div>
        <div class="table-row"><div class="label"><h5>Cost per PAX:</h5></div><div class="value" id="cpp">$${commaSeparateNumber(Math.floor(costPerPax))}</div></div>
        <div class="table-row"><div class="label">&#8205;</div></div>`;

    containerEl.querySelector('#cpp-costs-container').innerHTML = detailsHtml;

    var manufacturerEl = containerEl.querySelector('.manufacturer');
    manufacturerEl.innerHTML = `<span>${model.manufacturer}&nbsp;</span>`;
    manufacturerEl.appendChild(getCountryFlagImg(model.countryCode));
    containerEl.querySelector('.price').textContent = "$" + commaSeparateNumber(model.price);
    containerEl.querySelector('#lifespan').textContent = model.lifespan / 52 + " years";
    var deliveryEl = containerEl.querySelector('.delivery');
    var addBtn = containerEl.querySelector('.add');
    if (model.constructionTime == 0) {
        deliveryEl.textContent = "immediate";
        deliveryEl.classList.remove('warning');
        addBtn.textContent = 'Purchase';
    } else {
        deliveryEl.textContent = model.constructionTime + " weeks";
        deliveryEl.classList.add('warning');
        addBtn.textContent = 'Place Order';
    }
    model.rejection ? disableButton(addBtn, model.rejection) : enableButton(addBtn);
}

unsafeWindow.researchUpdateModelInfo = function(modelId) {
    let routeInfo = $("#searchCanvas").data(); // Keep .data()
    _genericUpdateModelInfo(modelId, routeInfo, '#researchAirplaneModelDetails', 40); // 40 is default service level
};

unsafeWindow.linkUpdateModelInfo = function(modelId) {
    let routeInfo = $("#detailsPanel").data(); // Keep .data()
    _genericUpdateModelInfo(modelId, routeInfo, '#airplaneModelDetails', routeInfo.rawQuality);
};

if (REMOVE_MOVING_BACKGROUND === true) {
    setTimeout(() => {
        document.body.style.cssText = `background: ${SOLID_BACKGROUND_COLOR};background-color: ${SOLID_BACKGROUND_COLOR};background-image: none;`;
    },1500);
}

console.log(`${GM_info.script.name} (${GM_info.script.version}) loaded`);
