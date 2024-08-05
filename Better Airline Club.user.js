// ==UserScript==
// @name         [BETA] BAC with H/T/D/T
// @namespace    http://tampermonkey.net/
// @version      2.0.2
// @description  Enhances airline-club.com and v2.airline-club.com airline management game (protip: Sign into your 2 accounts with one on each domain to avoid extra logout/login). Install this script with automatic updates by first installing TamperMonkey/ViolentMonkey/GreaseMonkey and installing it as a userscript.
// @author       Aphix/Torus (original "Cost Per PAX" portion by Alrianne @ https://github.com/wolfnether/Airline_Club_Mod/)
// @match        https://*.airline-club.com/
// @icon         https://www.google.com/s2/favicons?domain=airline-club.com
// @downloadURL  https://github.com/Bohaska/bac/raw/main/Better%20Airline%20Club.user.js
// @updateURL    https://github.com/Bohaska/bac/raw/main/Better%20Airline%20Club.user.js
// @grant        none
// ==/UserScript==

// ---- BEGIN of Section where user is expected to tweak things to make it how they like -------

var MIN_PLANES_TO_HIGHLIGHT = 500; // Changes which planes get the gold shadow/highlight on plane purchase table (not affected by filters in table header)

var REMOVE_MOVING_BACKGROUND = true; // perf enhancement, less noisy (gradients & transparency are still expensive in 2024, and my GPU has AI work to better spend it's time on)
var SOLID_BACKGROUND_COLOR = `rgb(83, 85, 113)`; // only matters if remove_moving_background is true

// Default filter values for plane purchase table header:
var DEFAULT_MIN_PLANES_IN_CIRCULATION_FILTER = 450; // Changes default minimum number of planes in circulation to remove from plane purchase table
var DEFAULT_MIN_FLIGHT_RANGE_FILTER = 1000;
var DEFAULT_RUNWAY_LENGTH_FILTER = 3000;
var DEFAULT_MIN_CAPACITY_FILTER = 0;

// ---- END of Section where user is expected to tweak things to make it how they like -------

// Plugin code starts here and goes to the end...
// Feel free to leave a comment on the gist if you have any questions or requests: https://gist.github.com/aphix/fdeeefbc4bef1ec580d72639bbc05f2d
// Want to donate? Don't. Buy yourself some ETH. If that works out nice and you want to pay it back later then find me on github.
// Note from Fly or die: I've released v2 of this mod. Thanks continentalysky for the commission!

function reportAjaxError(jqXHR, textStatus, errorThrown) {
    console.error(JSON.stringify(jqXHR));
    console.error("AJAX error: " + textStatus + ' : ' + errorThrown);
    // throw errorThrown;
}

function _request(url, method = 'GET', data = undefined) {
    return new Promise((resolve, reject) => {
        $.ajax({
            url,
            type: method,
            contentType: 'application/json; charset=utf-8',
            data: data ? JSON.stringify(data) : data,
            dataType: 'json',
            success: resolve,
            error: (...args) => {
                reportAjaxError(...args);
                reject(...args);
            }
        })
    })
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

function _populateDerivedFieldsOnLink(link) {
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

    //console.dir(link);
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
    $("#linkHistoryDetails").show()
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

async function loadCompetitionForLink(airlineId, link) {
    const linkConsumptions = await _request(`airports/${link.fromAirportId}/to/${link.toAirportId}`);

    $("#linkCompetitons .data-row").remove()
    $.each(linkConsumptions, function(index, linkConsumption) {
        var row = $("<div class='table-row data-row'><div style='display: table-cell;'>" + linkConsumption.airlineName
                + "</div><div style='display: table-cell;'>" + toLinkClassValueString(linkConsumption.price, "$")
                + "</div><div style='display: table-cell; text-align: right;'>" + toLinkClassValueString(linkConsumption.capacity)
                + "</div><div style='display: table-cell; text-align: right;'>" + linkConsumption.quality
                + "</div><div style='display: table-cell; text-align: right;'>" + linkConsumption.frequency + "</div></div>")

        if (linkConsumption.airlineId == airlineId) {
            $("#linkCompetitons .table-header").after(row) //self is always on top
        } else {
            $("#linkCompetitons").append(row)
        }

    })

    if ($("#linkCompetitons .data-row").length == 0) {
        $("#linkCompetitons").append("<div class='table-row data-row'><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div></div>")
    }

    $("#linkCompetitons").show()

    assignAirlineColors(linkConsumptions, "airlineId")
    plotPie(linkConsumptions, null, $("#linkCompetitionsPie"), "airlineName", "soldSeats")

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
    const linkHistory = await _request(`airlines/${airlineId}/link-consumptions/${linkId}?cycleCount=${cycleCount}`);

    $('#linkEventChart').data('linkConsumptions', linkHistory)

    if (jQuery.isEmptyObject(linkHistory)) {
        $("#linkHistoryPrice").text("-")
        $("#linkHistoryCapacity").text("-")
        $("#linkLoadFactor").text("-")
        $("#linkProfit").text("-")
        $("#linkRevenue").text("-")
        $("#linkFuelCost").text("-")
        $("#linkCrewCost").text("-")
        $("#linkAirportFees").text("-")
        $("#linkDepreciation").text("-")
        $("#linkCompensation").text("-")
        $("#linkLoungeCost").text("-")
        $("#linkServiceSupplies").text("-")
        $("#linkMaintenance").text("-")
        $("#linkOtherCosts").text("-")
        $("#linkDelays").text("-")
        $("#linkCancellations").text("-")

        disableButton($("#linkDetails .button.viewLinkHistory"), "Passenger Map is not yet available for this route - please wait for the simulation (time estimation on top left of the screen).")
        disableButton($("#linkDetails .button.viewLinkComposition"), "Passenger Survey is not yet available for this route - please wait for the simulation (time estimation on top left of the screen).")

        plotHistory(linkHistory);
        return;
    }


    if (!$("#linkAverageLoadFactor").length) {
        $("#linkLoadFactor").parent().after(`<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Load Factor:</h5></div>
            <div class="value" id="linkAverageLoadFactor"></div>
        </div>`)
    }

    if (!$("#linkAverageProfit").length) {
        $("#linkProfit").parent().after(`<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Profit:</h5></div>
            <div class="value" id="linkAverageProfit"></div>
        </div>`)
    }

    //if (!$("#doAutomaticPriceUpdate").length) {
    //    $("#linkLoadFactor").parent().after(`<div class="table-row" style="color:#999">
    //        <div class="button" id="doAutomaticPriceUpdate">Auto Manage</div>
    //    </div>`)
    //}

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
    $("#linkHistoryPrice").text(toLinkClassValueString(latestLinkData.price, "$"))
    $("#linkHistoryCapacity").text(toLinkClassValueString(latestLinkData.capacity))

    if (latestLinkData.totalLoadFactor !== 100) {
        let originalLink = link;
        //console.dir(originalLink);
        $("#doAutomaticPriceUpdate").click(() => {
            _doAutomaticPriceUpdateFor(originalLink);
        });

        $("#doAutomaticPriceUpdate").show();
    } else {
        $("#doAutomaticPriceUpdate").hide();
    }

    $("#linkLoadFactor").text(toLinkClassValueString(getLoadFactorsFor(latestLinkData), "", "%"))
    $("#linkAverageLoadFactor").text(toLinkClassValueString(averageLoadFactor, "", "%"))

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
        $('#'+elementId).text('$' + commaSeparateNumber(dollarValuesByElementId[elementId]));
    }

    if (latestLinkData.minorDelayCount == 0 && latestLinkData.majorDelayCount == 0) {
        $("#linkDelays").removeClass("warning")
        $("#linkDelays").text("-")
    } else {
        $("#linkDelays").addClass("warning")
        $("#linkDelays").text(latestLinkData.minorDelayCount + " minor " + latestLinkData.majorDelayCount + " major")
    }

    if (latestLinkData.cancellationCount == 0) {
        $("#linkCancellations").removeClass("warning")
        $("#linkCancellations").text("-")
    } else {
        $("#linkCancellations").addClass("warning")
        $("#linkCancellations").text(latestLinkData.cancellationCount)
    }
    enableButton($("#linkDetails .button.viewLinkHistory"))
    enableButton($("#linkDetails .button.viewLinkComposition"))

    plotHistory(linkHistory);

    return linkHistory;
}

async function loadLinkSurvey(airlineId, link) {
        if (!$("#paxOrigin").length) {
			$("#linkProfit").parent().before(`<div class="table-row">
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
        if (!$("#paxType").length) {
			$("#paxOrigin").parent().after(`<div class="table-row">
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
        if (!$("#newLoyalists").length) {
			$("#paxType").parent().after(`<div class="table-row">
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
        $("#paxOrigin").text(``);
        $("#paxType").text(``);
        $("#newLoyalists").text(``);
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
        $("#paxOrigin").text(`${homeAirportPax}/${homeTransitPax}/${destinationAirportPax}/${destinationTransitPax}`);
        $("#paxType").text(`${cheapPax}/${swiftPax}/${loyalistPax}`);
        $("#newLoyalists").text(`${cheapNewLoyalists}/${swiftNewLoyalists}/${loyalNewLoyalists}`);
    }

let lastPlotUnit;
window._getPlotUnit = function _getPlotUnit() {
    let checkedElem = $('#linkDetails fieldset .switch input:checked')[0];

    if (!checkedElem && lastPlotUnit) {
        return lastPlotUnit;
    }

    return lastPlotUnit = window.plotUnitEnum[checkedElem ? $(checkedElem).val().toUpperCase() : 'MONTH']
}

window.loadLink = async function loadLink(airlineId, linkId) {
    const link = await _request(`airlines/${airlineId}/links/${linkId}`)

    $('#linkEventModal').data('link', link)
    $("#linkFromAirport").attr("onclick", "showAirportDetails(" + link.fromAirportId + ")").html(getCountryFlagImg(link.fromCountryCode) + getAirportText(link.fromAirportCity, link.fromAirportCode))
    //$("#linkFromAirportExpectedQuality").attr("onclick", "loadLinkExpectedQuality(" + link.fromAirportId + "," + link.toAirportId + "," + link.fromAirportId + ")")
    $("#linkToAirport").attr("onclick", "showAirportDetails(" + link.toAirportId + ")").html(getCountryFlagImg(link.toCountryCode) + getAirportText(link.toAirportCity, link.toAirportCode))
    //$("#linkToAirportExpectedQuality").attr("onclick", "loadLinkExpectedQuality(" + link.fromAirportId + "," + link.toAirportId + "," + link.toAirportId + ")")
    $("#linkFlightCode").text(link.flightCode)
    if (link.assignedAirplanes && link.assignedAirplanes.length > 0) {
        $('#linkAirplaneModel').text(link.assignedAirplanes[0].airplane.name + "(" + link.assignedAirplanes.length + ")")
    } else {
        $('#linkAirplaneModel').text("-")
    }
    $("#linkCurrentPrice").text(toLinkClassValueString(link.price, "$"))
    $("#linkDistance").text(link.distance + " km (" + link.flightType + ")")
    $("#linkQuality").html(getGradeStarsImgs(Math.round(link.computedQuality / 10)) + link.computedQuality)
    $("#linkCurrentCapacity").text(toLinkClassValueString(link.capacity))
    if (link.future) {
        $("#linkCurrentDetails .future .capacity").text(toLinkClassValueString(link.future.capacity))
        $("#linkCurrentDetails .future").show()
    } else {
        $("#linkCurrentDetails .future").hide()
    }
    $("#linkCurrentDetails").show()

    $("#linkToAirportId").val(link.toAirportId)
    $("#linkFromAirportId").val(link.fromAirportId)

    const plotUnit = _getPlotUnit();

    // const plotUnit = $("#linkDetails #switchMonth").is(':checked')
    //     ? window.plotUnitEnum.MONTH
    //     : $("#linkDetails #switchQuarter").is(':checked')
    //         ? window.plotUnitEnum.QUARTER
    //         : window.plotUnitEnum.YEAR;

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

    //populate airplane model drop down
	var explicitlySelectedModelId = $("#planLinkModelSelect").data('explicitId')

	$("#viewLinkModelSelect").children('option').remove()

	//find which model is assigned to the existing link (if exist)
	const assignedModelId = link.modelId
	var selectedModelId

	if (explicitlySelectedModelId) { //if there was a explicitly selected model, for example from buying a new plane
		selectedModelId = explicitlySelectedModelId;
	} else {
        selectedModelId = assignedModelId
    }

    loadAirplaneModels();
    const fromAirport = airports.find(airport => airport.id === link.fromAirportId)
    const toAirport = airports.find(airport => airport.id === link.toAirportId)
    const minRunway = Math.min(fromAirport.runwayLength, toAirport.runwayLength)

    link.fromAirport = fromAirport
    link.toAirport = toAirport

    $("#detailsPanel").data(link)

    var arrayModels = Object.values(loadedModelsById)

    $.each(arrayModels, function(key, modelPlanLinkInfo) {
		if (modelPlanLinkInfo.id == selectedModelId) {
			modelPlanLinkInfo.owned = true
		} else {
			modelPlanLinkInfo.owned = false
		}
	})

    arrayModels = sortPreserveOrder(arrayModels, "owned", false)

    $("#viewLinkModelSelect").children('option').remove()

    $.each(arrayModels, function(id, model) {
        var modelId = model.id
        var modelname = model.name
        if (model.range >= link.distance && model.runwayRequirement <= minRunway) {
            let flightDuration = calcFlightTime(model, link.distance) ;

            let maxFlightMinutes = 4 * 24 * 60;
            let frequency = Math.floor(maxFlightMinutes / ((flightDuration + model.turnaroundTime) * 2));
            var option = $("<option></option>").attr("value", modelId).text(modelname + " (" + frequency + ")")

            option.appendTo($("#viewLinkModelSelect"))

            if (selectedModelId == modelId) {
                option.prop("selected", true)
                option.addClass("highlight-text")
                linkUpdateModelInfo(modelId)
            }
        }
    });

	$("#viewLinkModelSelect").show()

	setActiveDiv($("#extendedPanel #airplaneModelDetails"))

    return {
        link,
        linkCompetition,
        linkHistory,
        linkSurvey,
    };
}

const _editLink = window.editLink

window.editLink = function editLink(linkId) {
    $("#viewLinkModelSelect").hide()
    _editLink(linkId)
}

let originalShowSearchCanvas = window.showSearchCanvas
window.showSearchCanvas = function showSearchCanvas(historyAirline) {
    return originalShowSearchCanvas(historyAirline)
}

window.researchFlight = function researchFlight(fromAirportId, toAirportId) {
    if (fromAirportId && toAirportId) {
        var url = "research-link/" + fromAirportId + "/" + toAirportId

        $.ajax({
            type: 'GET',
            url: url,
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            success: function(result) {
                $("#searchCanvas").data(result);
                var fromAirport = result.fromAirport
                var toAirport = result.toAirport
                var fromAirportId = fromAirport.id
                var toAirportId = toAirport.id
                loadAirportImage(fromAirportId, $('#researchSearchResult img.fromAirport') )
                loadAirportImage(toAirportId, $('#researchSearchResult img.toAirport'))
                $("#researchSearchResult .fromAirportText").text(result.fromAirportText)
		        $("#researchSearchResult .fromAirportText")[0].setAttribute("onclick", `showAirportDetails(${fromAirportId})`)
                $("#researchSearchResult .fromAirport .population").text(commaSeparateNumber(result.fromAirport.population))
                $("#researchSearchResult .fromAirport .incomeLevel").text(result.fromAirport.incomeLevel)
                $("#researchSearchResult .toAirportText").text(result.toAirportText)
		        $("#researchSearchResult .toAirportText")[0].setAttribute("onclick", `showAirportDetails(${toAirportId})`)
		        populateNavigation($("#researchSearchResult"))
                $("#researchSearchResult .toAirport .population").text(commaSeparateNumber(result.toAirport.population))
                $("#researchSearchResult .toAirport .incomeLevel").text(result.toAirport.incomeLevel)

                $("#researchSearchResult .relationship").html(getCountryFlagImg(result.fromAirport.countryCode) + "&nbsp;vs&nbsp;" + getCountryFlagImg(result.toAirport.countryCode) + getCountryRelationshipDescription(result.mutualRelationship))
                $("#researchSearchResult .distance").text(result.distance)
                $("#researchSearchResult .flightType").text(result.flightType)
                $("#researchSearchResult .demand").text(toLinkClassValueString(result.directDemand))

                var $breakdown = $("#researchSearchResult .directDemandBreakdown")
                $breakdown.find(".fromAirport .airportLabel").empty()
                $breakdown.find(".fromAirport .airportLabel").append(getAirportSpan(fromAirport))
                $breakdown.find(".fromAirport .businessDemand").text(toLinkClassValueString(result.fromAirportBusinessDemand))
                $breakdown.find(".fromAirport .touristDemand").text(toLinkClassValueString(result.fromAirportTouristDemand))

                $breakdown.find(".toAirport .airportLabel").empty()
                $breakdown.find(".toAirport .airportLabel").append(getAirportSpan(toAirport))
                $breakdown.find(".toAirport .businessDemand").text(toLinkClassValueString(result.toAirportBusinessDemand))
                $breakdown.find(".toAirport .touristDemand").text(toLinkClassValueString(result.toAirportTouristDemand))


                $("#researchSearchResult .table.links .table-row").remove()

                const usedModels = []

                $.each(result.links, function(index, link) {
                    var $row = $("<div class='table-row'><div class='cell'>" + link.airlineName
                        + "</div><div class='cell'>" + link.modelName
                        + "</div><div class='cell'>" + toLinkClassValueString(link.price, "$")
                        + "</div><div class='cell'>" + toLinkClassValueString(link.capacity)
                        + "</div><div class='cell'>" + link.computedQuality
                        + "</div><div class='cell'>" + link.frequency + "</div></div>")
                    $('#researchSearchResult .table.links').append($row)
                    usedModels.push(link.modelId)
                })
                var selectedModel = null
                if (result.links.length == 0) {
                    var $row = $("<div class='table-row'><div class='cell'>-"
                                            + "</div><div class='cell'>-"
                                            + "</div><div class='cell'>-"
                                            + "</div><div class='cell'>-"
                                            + "</div><div class='cell'>-</div></div>")
                    $('#researchSearchResult .table.links').append($row)
                } else {
                    selectedModel = result.links[0].modelId
                }

                assignAirlineColors(result.consumptions, "airlineId")
                plotPie(result.consumptions, null, $("#researchSearchResult .linksPie"), "airlineName", "soldSeats")

                $('#researchSearchResult').show()

                const minRunway = Math.min(fromAirport.runwayLength, toAirport.runwayLength)
                const distance = result.distance
                loadAirplaneModels();

                var arrayModels = Object.values(loadedModelsById)

                $.each(arrayModels, function(key, modelPlanLinkInfo) {
                    if (usedModels.includes(modelPlanLinkInfo.id)) {
                        modelPlanLinkInfo.used = true
                    } else {
                        modelPlanLinkInfo.used = false
                    }
                })

                arrayModels = sortPreserveOrder(arrayModels, "used", false)

                $("#researchFlightModelSelect").children('option').remove()

                $.each(arrayModels, function(id, model) {
                    var modelId = model.id
                    var modelname = model.name
                    if (model.range >= distance && model.runwayRequirement <= minRunway) {
                        if (selectedModel === null) {
                            selectedModel = modelId
                        }
                        let flightDuration = calcFlightTime(model, distance) ;

                        let maxFlightMinutes = 4 * 24 * 60;
                        let frequency = Math.floor(maxFlightMinutes / ((flightDuration + model.turnaroundTime) * 2));
                        var option = $("<option></option>").attr("value", modelId).text(modelname + " (" + frequency + ")")

                        option.appendTo($("#researchFlightModelSelect"))

                        if (selectedModel == modelId) {
                            option.prop("selected", true)
                            researchUpdateModelInfo(modelId)
                        }

                        if (usedModels.includes(modelId)) {
                            option.addClass("highlight-text")
                        }
                    }
                });

                //plot consumptions
             },
             error: function(jqXHR, textStatus, errorThrown) {
                            console.log(JSON.stringify(jqXHR));
                            console.log("AJAX error: " + textStatus + ' : ' + errorThrown);
             },
             complete:function() {
                          //Hide the loader over here
                          input.parent().find(".spinner").hide()
                          currentSearchAjax = undefined
             },
             beforeSend: function() {
                 $('body .loadingSpinner').show()
             },
             complete: function(){
                 $('body .loadingSpinner').hide()
             }
        });
    }
}

window.researchUpdateModelInfo = function researchUpdateModelInfo(modelId) {
    let routeInfo = $("#searchCanvas").data()
	let model = loadedModelsById[modelId]
	$('#researchAirplaneModelDetails .selectedModel').val(modelId)
	$('#researchAirplaneModelDetails #modelName').text(model.name)
	$('#researchAirplaneModelDetails .modelFamily').text(model.family)
	$('#researchAirplaneModelDetails #capacity').text(model.capacity)
	$('#researchAirplaneModelDetails #airplaneType').text(model.airplaneType)
	$('#researchAirplaneModelDetails .turnaroundTime').text(model.turnaroundTime)
	$('#researchAirplaneModelDetails .runwayRequirement').text(model.runwayRequirement)
	$('#researchAirplaneModelDetails #fuelBurn').text(model.fuelBurn)
	$('#researchAirplaneModelDetails #range').text(model.range + "km")
	$('#researchAirplaneModelDetails #speed').text(model.speed + "km/h")
	$('#researchAirplaneModelDetails #lifespan').text(model.lifespan / 52 + " years")

	var $manufacturerSpan = $('<span>' + model.manufacturer + '&nbsp;</span>')
	$manufacturerSpan.append(getCountryFlagImg(model.countryCode))
	$('#researchAirplaneModelDetails .manufacturer').empty()
	$('#researchAirplaneModelDetails .manufacturer').append($manufacturerSpan)
	$('#researchAirplaneModelDetails .price').text("$" + commaSeparateNumber(model.price))

	if (model.constructionTime == 0) {
		$('#researchAirplaneModelDetails .delivery').text("immediate")
		$('#researchAirplaneModelDetails .delivery').removeClass('warning')
		$('#researchAirplaneModelDetails .add').text('Purchase')
	} else {
		$('#researchAirplaneModelDetails .delivery').text(model.constructionTime + " weeks")
		$('#researchAirplaneModelDetails .delivery').addClass('warning')
		$('#researchAirplaneModelDetails .add').text('Place Order')
	}

	if (model.rejection) {
		disableButton($('#researchAirplaneModelDetails .add'), model.rejection)
	} else {
		enableButton($('#researchAirplaneModelDetails .add'))
	}

    let serviceLevel = 40;
    let frequency = 0;

    let plane_category = _getPlaneCategoryFor(model);

    let baseSlotFee = 0;

    let distance = routeInfo.distance

    let airportFrom = routeInfo.fromAirport
    let airportTo = routeInfo.toAirport

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
        if (distance <= 1000) {
            basic = 8;
        } else if (distance <= 3000) {
            basic = 10;
        } else {
            basic = 12;
        }
    } else if (airportFrom.zone == airportTo.zone){
        if (distance <= 2000) {
            basic = 10;
        } else if (distance <= 4000) {
            basic = 15;
        } else {
            basic = 20;
        }
    } else {
        if (distance <= 2000) {
            basic = 15;
            multiplyFactor = 3;
        } else if (distance <= 5000) {
            basic = 25;
            multiplyFactor = 3;
        } else if (distance <= 12000) {
            basic = 30;
            multiplyFactor = 4;
        } else {
            basic = 30;
            multiplyFactor = 4;
        }
    }

    let staffPerFrequency = multiplyFactor * 0.4;
    let staffPer1000Pax = multiplyFactor;

    let duration = calcFlightTime(model, distance)
    let durationInHour = duration / 60;

    let price = model.price;
    if( model.originalPrice){
        price = model.originalPrice;
    }
    let baseDecayRate = 100 / model.lifespan;

    let maintenance = 0;
    let depreciationRate = 0;

    let maxFlightMinutes = 4 * 24 * 60;
    frequency = Math.floor(maxFlightMinutes / ((duration + model.turnaroundTime)*2));

    let flightTime = frequency * 2 * (duration + model.turnaroundTime);
    let availableFlightMinutes = maxFlightMinutes - flightTime;
    let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
    let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

    let decayRate = 100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation);
    depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);
    maintenance += model.capacity * 100 * utilisation;

    let fuelCost = frequency;

    if (duration <= 90){
        fuelCost *= model.fuelBurn * duration * 5.5 * 0.08;
    }else{
        fuelCost *= model.fuelBurn * (duration + 495) * 0.08;
    }

    let crewCost = model.capacity * durationInHour * 12 * frequency;
    let airportFees = (baseSlotFee * plane_category + (Math.min(3, airportTo.size) + Math.min(3, airportFrom.size)) * model.capacity) * frequency;
    let servicesCost = (20 + serviceLevelCost * durationInHour) * model.capacity * 2 * frequency;
    let cost = fuelCost + crewCost + airportFees + depreciationRate + servicesCost + maintenance;

    let staffTotal = Math.floor(basic + staffPerFrequency * frequency + staffPer1000Pax * model.capacity * frequency / 1000);

    $('#researchAirplaneModelDetails #FCPF').text("$" + commaSeparateNumber(Math.floor(fuelCost)));
    $('#researchAirplaneModelDetails #CCPF').text("$" + commaSeparateNumber(Math.floor(crewCost)));
    $('#researchAirplaneModelDetails #AFPF').text("$" + commaSeparateNumber(airportFees));
    $('#researchAirplaneModelDetails #depreciation').text("$" + commaSeparateNumber(Math.floor(depreciationRate)));
    $('#researchAirplaneModelDetails #SSPF').text("$" + commaSeparateNumber(Math.floor(servicesCost)));
    $('#researchAirplaneModelDetails #maintenance').text("$" + commaSeparateNumber(Math.floor(maintenance)));
    $('#researchAirplaneModelDetails #cpp').text("$" + commaSeparateNumber(Math.floor(cost / (model.capacity * frequency))) + " * " + (model.capacity * frequency));
    $('#researchAirplaneModelDetails #cps').text("$" + commaSeparateNumber(Math.floor(cost / staffTotal)) + " * " + staffTotal);
}

window.linkUpdateModelInfo = function linkUpdateModelInfo(modelId) {
    let routeInfo = $("#detailsPanel").data()
	let model = loadedModelsById[modelId]
	$('#airplaneModelDetails .selectedModel').val(modelId)
	$('#airplaneModelDetails #modelName').text(model.name)
	$('#airplaneModelDetails .modelFamily').text(model.family)
	$('#airplaneModelDetails #capacity').text(model.capacity)
	$('#airplaneModelDetails #airplaneType').text(model.airplaneType)
	$('#airplaneModelDetails .turnaroundTime').text(model.turnaroundTime)
	$('#airplaneModelDetails .runwayRequirement').text(model.runwayRequirement)
	$('#airplaneModelDetails #fuelBurn').text(model.fuelBurn)
	$('#airplaneModelDetails #range').text(model.range + "km")
	$('#airplaneModelDetails #speed').text(model.speed + "km/h")
	$('#airplaneModelDetails #lifespan').text(model.lifespan / 52 + " years")

	var $manufacturerSpan = $('<span>' + model.manufacturer + '&nbsp;</span>')
	$manufacturerSpan.append(getCountryFlagImg(model.countryCode))
	$('#airplaneModelDetails .manufacturer').empty()
	$('#airplaneModelDetails .manufacturer').append($manufacturerSpan)
	$('#airplaneModelDetails .price').text("$" + commaSeparateNumber(model.price))

	if (model.constructionTime == 0) {
		$('#airplaneModelDetails .delivery').text("immediate")
		$('#airplaneModelDetails .delivery').removeClass('warning')
		$('#airplaneModelDetails .add').text('Purchase')
	} else {
		$('#airplaneModelDetails .delivery').text(model.constructionTime + " weeks")
		$('#airplaneModelDetails .delivery').addClass('warning')
		$('#airplaneModelDetails .add').text('Place Order')
	}

	if (model.rejection) {
		disableButton($('#airplaneModelDetails .add'), model.rejection)
	} else {
		enableButton($('#airplaneModelDetails .add'))
	}

    let serviceLevel = 40;
    let frequency = 0;

    let plane_category = _getPlaneCategoryFor(model);

    let baseSlotFee = 0;

    let distance = routeInfo.distance

    let airportFrom = routeInfo.fromAirport
    let airportTo = routeInfo.toAirport

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
        if (distance <= 1000) {
            basic = 8;
        } else if (distance <= 3000) {
            basic = 10;
        } else {
            basic = 12;
        }
    } else if (airportFrom.zone == airportTo.zone){
        if (distance <= 2000) {
            basic = 10;
        } else if (distance <= 4000) {
            basic = 15;
        } else {
            basic = 20;
        }
    } else {
        if (distance <= 2000) {
            basic = 15;
            multiplyFactor = 3;
        } else if (distance <= 5000) {
            basic = 25;
            multiplyFactor = 3;
        } else if (distance <= 12000) {
            basic = 30;
            multiplyFactor = 4;
        } else {
            basic = 30;
            multiplyFactor = 4;
        }
    }

    let staffPerFrequency = multiplyFactor * 0.4;
    let staffPer1000Pax = multiplyFactor;

    let duration = calcFlightTime(model, distance)
    let durationInHour = duration / 60;

    let price = model.price;
    if( model.originalPrice){
        price = model.originalPrice;
    }
    let baseDecayRate = 100 / model.lifespan;

    let maintenance = 0;
    let depreciationRate = 0;

    let maxFlightMinutes = 4 * 24 * 60;
    frequency = Math.floor(maxFlightMinutes / ((duration + model.turnaroundTime)*2));

    let flightTime = frequency * 2 * (duration + model.turnaroundTime);
    let availableFlightMinutes = maxFlightMinutes - flightTime;
    let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
    let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

    let decayRate = 100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation);
    depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);
    maintenance += model.capacity * 100 * utilisation;

    let fuelCost = frequency;

    if (duration <= 90){
        fuelCost *= model.fuelBurn * duration * 5.5 * 0.08;
    }else{
        fuelCost *= model.fuelBurn * (duration + 495) * 0.08;
    }

    let crewCost = model.capacity * durationInHour * 12 * frequency;
    let airportFees = (baseSlotFee * plane_category + (Math.min(3, airportTo.size) + Math.min(3, airportFrom.size)) * model.capacity) * frequency;
    let servicesCost = (20 + serviceLevelCost * durationInHour) * model.capacity * 2 * frequency;
    let cost = fuelCost + crewCost + airportFees + depreciationRate + servicesCost + maintenance;

    let staffTotal = Math.floor(basic + staffPerFrequency * frequency + staffPer1000Pax * model.capacity * frequency / 1000);

    $('#airplaneModelDetails #FCPF').text("$" + commaSeparateNumber(Math.floor(fuelCost)));
    $('#airplaneModelDetails #CCPF').text("$" + commaSeparateNumber(Math.floor(crewCost)));
    $('#airplaneModelDetails #AFPF').text("$" + commaSeparateNumber(airportFees));
    $('#airplaneModelDetails #depreciation').text("$" + commaSeparateNumber(Math.floor(depreciationRate)));
    $('#airplaneModelDetails #SSPF').text("$" + commaSeparateNumber(Math.floor(servicesCost)));
    $('#airplaneModelDetails #maintenance').text("$" + commaSeparateNumber(Math.floor(maintenance)));
    $('#airplaneModelDetails #cpp').text("$" + commaSeparateNumber(Math.floor(cost / (model.capacity * frequency))) + " * " + (model.capacity * frequency));
    $('#airplaneModelDetails #cps').text("$" + commaSeparateNumber(Math.floor(cost / staffTotal)) + " * " + staffTotal);
}

window.cancelPlanLink = function cancelPlanLink() {
	//remove the temp path
	if (tempPath) { //create new link
		removeTempPath()
		//hideActiveDiv($('#planLinkDetails'))
		$('#sidePanel').fadeOut(200) //hide the whole side panel
	} else { //simply go back to linkDetails of the current link (exit edit mode)
        if (document.querySelector("#viewLinkModelSelect").selectedOptions.length > 0) {
            document.querySelector("#viewLinkModelSelect").selectedOptions[0].selected = false
        }
        $(document.querySelector("#viewLinkModelSelect").options).filter(function(i, option) {return option.value == document.querySelector("#planLinkModelSelect").selectedOptions[0].value})[0].selected = true;
        $("#viewLinkModelSelect").show()
		setActiveDiv($('#linkDetails'))
	}
}

async function _updateLatestOilPriceInHeader() {
    const oilPrices = await _request('oil-prices');
    const latestPrice = oilPrices.slice(-1)[0].price;

    if (!$('.topBarDetails .latestOilPriceShortCut').length) {
        $('.topBarDetails .delegatesShortcut').after(`
            <span style="margin: 0px 10px; padding: 0 5px"  title="Latest Oil Price" class="latestOilPriceShortCut clickable" onclick="showOilCanvas()">
                <span class="latest-price label" style=""></span>
            </span>
        `);
    }

    const tierForPrice = 5 - getTierFromPercent(latestPrice, 40, 80);

    if (tierForPrice < 2) {
        $('.latestOilPriceShortCut')
            .addClass('glow')
            .addClass('button');
    } else {
        $('.latestOilPriceShortCut')
            .removeClass('glow')
            .removeClass('button');
    }

    $('.topBarDetails .latest-price')
        .text('$'+commaSeparateNumber(latestPrice))
        .attr({style: getStyleFromTier(tierForPrice)});

    setTimeout(() => {
        _updateLatestOilPriceInHeader();
    }, Math.round(Math.max(durationTillNextTick / 2, 30000)));
}

window.loadOwnedAirplaneDetails = function loadOwnedAirplaneDetails(airplaneId, selectedItem, closeCallback, disableChangeHome) {
	//highlight the selected model
//	if (selectedItem) {
//	    selectedItem.addClass("selected")
//    }

	var airlineId = activeAirline.id
	$("#actionAirplaneId").val(airplaneId)
	var currentCycle
	$.ajax({
        type: 'GET',
        url: "current-cycle",
        contentType: 'application/json; charset=utf-8',
        dataType: 'json',
        async: false,
        success: function(result) {
            currentCycle = result.cycle
        },
        error: function(jqXHR, textStatus, errorThrown) {
                console.log(JSON.stringify(jqXHR));
                console.log("AJAX error: " + textStatus + ' : ' + errorThrown);
        }
    });

    currentAirplaneLoadCall =
    {
    		type: 'GET',
    		url: "airlines/" + airlineId + "/airplanes/" + airplaneId,
    	    contentType: 'application/json; charset=utf-8',
    	    dataType: 'json',
    	    success: function(airplane) {
    	        var model = loadedModelsById[airplane.modelId]
                if (model.imageUrl) {
                    var imageLocation = 'assets/images/airplanes/' + model.name.replace(/\s+/g, '-').toLowerCase() + '.png'
                    $('#ownedAirplaneDetail .modelIllustration img').attr('src', imageLocation)
                    $('#ownedAirplaneDetail .modelIllustration a').attr('href', model.imageUrl)
                    $('#ownedAirplaneDetail .modelIllustration').show()
                } else {
                    $('#ownedAirplaneDetail .modelIllustration').hide()
                }

    	    	$("#airplaneDetailsId").text(airplane.id)
        		$("#airplaneDetailsCondition").text(airplane.condition.toFixed(2) + "%")
        		$("#airplaneDetailsCondition").removeClass("warning fatal")
        		if (airplane.condition < airplane.criticalConditionThreshold) {
        			$("#airplaneDetailsCondition").addClass("fatal")
        		} else if (airplane.condition < airplane.badConditionThreshold) {
        			$("#airplaneDetailsCondition").addClass("warning")
        		}
        		var age = currentCycle - airplane.constructedCycle

        		if (age >= 0) {
        			$("#airplaneDetailsAge").text(getYearMonthText(age))
        			$("#airplaneDetailsAgeRow").show()
        			$("#airplaneDetailsDeliveryRow").hide()
        		} else {
        			$("#airplaneDetailsDelivery").text(age * -1 + "week(s)")
        			$("#airplaneDetailsAgeRow").hide()
        			$("#airplaneDetailsDeliveryRow").show()
        		}
    	    	$("#airplaneDetailsSellValue").text("$" + commaSeparateNumber(airplane.sellValue))
    	    	var replaceCost = model.price - airplane.sellValue
                $("#airplaneDetailsReplaceCost").text("$" + commaSeparateNumber(replaceCost))
    	    	$("#airplaneDetailsLink").empty()
    	    	if (airplane.links.length > 0) {
    	    	    $.each(airplane.links, function(index, linkEntry) {
    	    	        var link = linkEntry.link
    	    	        var linkDescription = "<div style='display: flex; align-items: center;'>" + getAirportText(link.fromAirportCity, link.fromAirportCode) + "<img src='assets/images/icons/arrow.png'>" + getAirportText(link.toAirportCity, link.toAirportCode) + " " + linkEntry.frequency + " flight(s) per week</div>"
    	    	        $("#airplaneDetailsLink").append("<div><a data-link='show-link-from-airplane' href='javascript:void(0)' onclick='closeAllAndStoreAirplaneModals(); showWorldMap(); selectLinkFromMap(" + link.id + ", true)'>" + linkDescription + "</a></div>" )
    	    	        populateNavigation($("#airplaneDetailsLink"))
    	    	    })
    	    		disableButton("#sellAirplaneButton", "Cannot sell airplanes with route assigned")
    	    	} else {
    	    		$("#airplaneDetailsLink").text("-")
    	    		if (age >= 0) {
    	    		    enableButton("#sellAirplaneButton")
    	    		} else {
    	    			disableButton("#sellAirplaneButton", "Cannot sell airplanes that are still under construction")
    	    		}

    	    	}
                let utilization = Math.floor((airplane.maxFlightMinutes - airplane.availableFlightMinutes) / 5760 * 100)
    	    	$("#ownedAirplaneDetail .availableFlightMinutes").text(airplane.availableFlightMinutes)
                $("#ownedAirplaneDetail .utilization").text(utilization)
    	    	populateAirplaneHome(airplane, disableChangeHome)

                var weeksRemainingBeforeReplacement = airplane.constructionTime - (currentCycle - airplane.purchasedCycle)
    	    	if (weeksRemainingBeforeReplacement <= 0) {
    	    	    if (activeAirline.balance < replaceCost) {
                	    disableButton("#replaceAirplaneButton", "Not enough cash to replace this airplane")
                	} else {
    	    	        enableButton("#replaceAirplaneButton")
                    }
    	    	} else {
                    disableButton("#replaceAirplaneButton", "Can only replace this airplane " + weeksRemainingBeforeReplacement + " week(s) from now")
    	    	}

    	    	$("#ownedAirplaneDetail").data("airplane", airplane)

                $.ajax({
                    type: 'GET',
                    url: "airlines/" + airlineId + "/configurations?modelId=" + airplane.modelId,
                    contentType: 'application/json; charset=utf-8',
                    dataType: 'json',
                    success: function(result) {
                        var configuration
                        var matchingIndex
                        $.each(result.configurations, function(index, option) {
                            if (option.id == airplane.configurationId) {
                                configuration = option
                                matchingIndex = index
                            }
                        })

                        //just in case, sometimes it comes to a stale state
                        if (configuration == null && result.configurations) {
                            configuration = result.configurations[0]
                            matchingIndex = 0
                        }

                        plotSeatConfigurationBar($('#ownedAirplaneDetailModal .configurationBar'), configuration, airplane.capacity, result.spaceMultipliers)

                        if (result.configurations.length <= 1) { //then cannot change
                            $("#ownedAirplaneDetail .configuration-view .edit").hide()
                            $("#ownedAirplaneDetail .configuration-view .editDisabled").show()
                        } else {
                            $("#ownedAirplaneDetail .configuration-view .show").hide()

                            //populateConfigurationOptionsFunction = function() { //delay this as the div is not visible and fusionchart would not render it
                                $("#ownedAirplaneDetail .configuration-options").empty()
                                $("#ownedAirplaneDetail .configuration-options").data("selectedIndex", 0)
                                $("#ownedAirplaneDetail .configuration-options").data("optionCount", result.configurations.length)
                                for (i = 0 ; i < result.configurations.length; i ++) {
                                    //start from the matching one
                                    var index = (i + matchingIndex) % result.configurations.length
                                    var option = result.configurations[index]
                                    var barDiv = $("<div style='width : 100%' class='configuration-option'></div>")
                                    $("#ownedAirplaneDetail .configuration-options").append(barDiv)
                                    barDiv.data("configurationId", option.id)
                                    if (i != 0) { //if not the matching one, hide by default
                                        barDiv.hide()
                                    }
                                    plotSeatConfigurationBar(barDiv, option, airplane.capacity, result.spaceMultipliers)
                                }
                            //}
                            $("#ownedAirplaneDetail .configuration-view .edit").show()
                            $("#ownedAirplaneDetail .configuration-view .editDisabled").hide()
                        }
                        $("#ownedAirplaneDetail .configuration-view").show()
                        $("#ownedAirplaneDetail .configuration-edit").hide()

                        if (closeCallback) {
                            $("#ownedAirplaneDetailModal").data("closeCallback", function() {
                                if ($("#ownedAirplaneDetailModal").data("hasChange")) { //only trigger close callback if there are changes
                                    closeCallback()
                                    $("#ownedAirplaneDetailModal").removeData("hasChange")
                                }
                            })
                        } else {
                            $("#ownedAirplaneDetailModal").removeData("closeCallback")
                        }
                        $("#ownedAirplaneDetailModal").fadeIn(200)
                    },
                     error: function(jqXHR, textStatus, errorThrown) {
                    	            console.log(JSON.stringify(jqXHR));
                    	            console.log("AJAX error: " + textStatus + ' : ' + errorThrown);
                    	    }
                });




    	    },
            error: function(jqXHR, textStatus, errorThrown) {
    	            console.log(JSON.stringify(jqXHR));
    	            console.log("AJAX error: " + textStatus + ' : ' + errorThrown);
    	    }
    	}
	$.ajax(currentAirplaneLoadCall);
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

function launch(){

    window.plotUnitEnum = {
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

    window.commaSeparateNumberForLinks = commaSeparateNumberForLinks;

    var cachedTotalsById = window.cachedTotalsById = {};
    window.cachedTotalsById = cachedTotalsById;

	window.loadAirplaneModelStats = async function loadAirplaneModelStats(modelInfo, opts = {}) {
	    var url
	    var favoriteIcon = $("#airplaneModelDetail .favorite")
	    var model = loadedModelsById[modelInfo.id]
	    if (activeAirline) {
	        url = "airlines/" + activeAirline.id + "/airplanes/model/" + model.id + "/stats",
	        favoriteIcon.show()
	    } else {
	        url = "airplane-models/" + model.id + "/stats"
	        favoriteIcon.hide()
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
    	$('#airplaneCanvas .total').text(stats.total)

    	cachedTotalsById[model.id] = model.in_use = stats.total;

    	if (stats.favorite === undefined) {
    		return;
    	}

	    favoriteIcon.off() //remove all listeners

        if (stats.favorite.rejection) {
            $("#setFavoriteModal").data("rejection", stats.favorite.rejection)
        } else {
            $("#setFavoriteModal").removeData("rejection")
        }

        if (modelInfo.isFavorite) {
            favoriteIcon.attr("src", "assets/images/icons/heart.png")
            $("#setFavoriteModal").data("rejection", "This is already the Favorite")
        } else {
            favoriteIcon.attr("src", "assets/images/icons/heart-empty.png")
        }

        $("#setFavoriteModal").data("model", model)
	}

    window.updateCustomLinkTableHeader = function updateCustomLinkTableHeader() {
        if ($('#linksTableSortHeader').children().length === 15) {
            return;
        }

        $('#linksCanvas .mainPanel').css({width: '62%'});
        $('#linksCanvas .sidePanel').css({width: '38%'});

        $('#canvas .mainPanel').css({width: '62%'});
        $('#canvas .sidePanel').css({width: '38%'});

        const widths = [
            8,
            8,
            8,
            7,
            9,
            5,
            5,
            5,
            9,
            8,
            6,
            6,
            7,
            7,
            2, //tiers, 1st
        ];

        const sum = widths.reduce((acc, val) => acc + val, 0);
        if (sum !== 100) {
            console.warn(`Column widths to not add up to 100: ${sum} (${widths.join(',')}) -- ${sum < 100 ? 'Remaining' : 'Over by'}: ${sum < 100 ? 100 - sum : sum - 100}%`)
        }

        $('#linksTableSortHeader').html(`
            <div class="cell clickable" style="width: ${widths[14]}%" data-sort-property="tiersRank" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))" title="Aggregated Rank">#</div>
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
            <div class="cell clickable" style="width: ${widths[10]}%" align="right" data-sort-property="profitMargin" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Gain</div>
            <div class="cell clickable" style="width: ${widths[11]}%" align="right" data-sort-property="profitPerPax" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/🧍</div>
            <div class="cell clickable" style="width: ${widths[12]}%" align="right" data-sort-property="profitPerFlight" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/✈</div>
            <div class="cell clickable" style="width: ${widths[13]}%" align="right" data-sort-property="profitPerHour" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/⏲</div>
        `);

        $('#linksTable .table-header').html(`
            <div class="cell" style="width: ${widths[14]}%; border-bottom: none;"></div>
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
        `);
    }

    window.loadLinksTable = async function loadLinksTable() {
        const links = await _request(`airlines/${activeAirline.id}/links-details`);

        _updateChartOptionsIfNeeded();
        updateCustomLinkTableHeader();
        updateLoadedLinks(links);

        $.each(links, (key, link) => _populateDerivedFieldsOnLink(link));

        var selectedSortHeader = $('#linksTableSortHeader .cell.selected')
        updateLinksTable(selectedSortHeader.data('sort-property'), selectedSortHeader.data('sort-order'))
    }

    var colorKeyMaps = {};
    window.updateLinksTable = function updateLinksTable(sortProperty, sortOrder) {
        var linksTable = $("#linksCanvas #linksTable")
        linksTable.children("div.table-row").remove()

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

        $.each(loadedLinks, function(index, link) {
            var row = $("<div class='table-row clickable' onclick='selectLinkFromTable($(this), " + link.id + ")'></div>")

            var srcAirportFull = getAirportText(link.fromAirportCity, link.fromAirportCode);
            var destAirportFull = getAirportText(link.toAirportCity, link.toAirportCode);

            //                 COMMENT one set or the other to test both:
            // Truncated
            //
            row.append("<div class='cell' title='"+ srcAirportFull +"'>" + getCountryFlagImg(link.fromCountryCode) + ' ' + srcAirportFull.slice(-4, -1) + "</div>")
            row.append("<div class='cell' title='"+ destAirportFull +"'>" + getCountryFlagImg(link.toCountryCode) + ' ' + destAirportFull.slice(-4, -1) + "</div>")
            //
            //    OR
            //
            // Original/Full airport names
            //
            //row.append("<div class='cell'>" + getCountryFlagImg(link.fromCountryCode) + ' ' + srcAirportFull + "</div>")
            //row.append("<div class='cell'>" + getCountryFlagImg(link.toCountryCode) + ' ' + destAirportFull + "</div>")
            //
            //    OR
            //
            // Reversed, IATA/ICAO first w/ truncation
            //
            //row.append("<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;' title='"+ srcAirportFull +"'>" + getCountryFlagImg(link.fromCountryCode) + ' ' + srcAirportFull.slice(-4, -1) + ' | ' + srcAirportFull.slice(0, -5) + "</div>")
            //row.append("<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;' title='"+ destAirportFull +"'>" + getCountryFlagImg(link.toCountryCode) + ' ' + destAirportFull.slice(-4, -1) + ' | ' + destAirportFull.slice(0, -5) + "</div>")
            //

            row.append("<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;'>" + getShortModelName(link.model) + "</div>")
            row.append("<div class='cell' align='right'>" + link.distance + "km</div>")
            row.append("<div class='cell' align='right'>" + link.totalCapacity + " (" + link.frequency + ")</div>")
            row.append("<div class='cell' align='right'>" + link.totalPassengers + "</div>")

            // row.append("<div style='"+getKeyedStyleFromLink(link, 'totalLoadFactor', 0, 100)+"' class='cell' align='right'>" + link.totalLoadFactor + '%' + "</div>")
            const lfBreakdown = {
                economy: link.passengers.economy / link.capacity.economy,
                business: link.passengers.business / link.capacity.business,
                first: link.passengers.first / link.capacity.first,
            };

            let lfBreakdownText = link.totalLoadFactor === 100
                ? '100'
                : [lfBreakdown.economy, lfBreakdown.business, lfBreakdown.first].map(v => v ? Math.floor(100 * v) : '-').join('/').replace(/(\/\-)+$/g, '')

            row.append("<div style='"+getKeyedStyleFromLink(link, 'totalLoadFactor', 0, 100)+"' class='cell' align='right'>" + lfBreakdownText + '%' + "</div>")

            row.append("<div style='" + getKeyedStyleFromLink(link, "satisfaction", 0.6, 1) + "' class='cell' align='right'>" + Math.round(Math.max(link.satisfaction - 0.6, 0) * 250) + "%" + "</div>");
            row.append("<div style='"+getKeyedStyleFromLink(link, 'revenue')+"'  class='cell' align='right' title='$"+ commaSeparateNumber(link.revenue) +"'>" + '$' + commaSeparateNumberForLinks(link.revenue) + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profit')+"'  class='cell' align='right' title='$"+ commaSeparateNumber(link.profit) +"'>" + '$' + commaSeparateNumberForLinks(link.profit) +"</div>")

            //row.append("<div style='color:"+textColor+";' class='cell' align='right'>" + (link.profitMargin > 0 ? '+' : '') + Math.round(link.profitMargin) + "%</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitMarginPercent', 0, 136.5)+"' class='cell' align='right'>" + (link.profitMargin > 0 ? '+' : '') + Math.round(link.profitMargin) + "%</div>")

            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitPerPax')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerPax) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerPax) + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitPerFlight')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerFlight) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerFlight) + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitPerHour')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerHour) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerHour) + "</div>")

            if (selectedLink == link.id) {
                row.addClass("selected")
            }

            const tiersRank = link.tiersRank = Object.keys(link.tiers).reduce((sum, key) => sum + link.tiers[key] + (key === 'profit' && link.tiers[key] === 0 ? -1 : 0), 0);

            row.prepend("<div class='cell'>" + link.tiersRank + "</div>")

            if (tiersRank < 2) {
                row.css({'text-shadow': '0 0 3px gold'});
            }

            if (tiersRank > 27) {
                row.css({'text-shadow': '0 0 3px red'});
            }

            linksTable.append(row)
        });
    }

    window.refreshLinkDetails = async function refreshLinkDetails(linkId) {
        const airlineId = activeAirline.id

        $("#linkCompetitons .data-row").remove()
        $("#actionLinkId").val(linkId)

        // load link
        const linkDetailsPromise = loadLink(airlineId, linkId); // not awaiting yet so we can kickoff the panel open animation while loading

        setActiveDiv($("#linkDetails"))
        hideActiveDiv($("#extendedPanel #airplaneModelDetails"))
        $('#sidePanel').fadeIn(200);

        const { link, linkCompetition, linkHistory } = await linkDetailsPromise; // link details loaded if needed for something later
    }

    function _updateChartOptionsIfNeeded() {
        if ($('#linkDetails fieldset .switch #switchYear').length === 1) {
            return
        }

        $('#linkDetails fieldset .switch').parent().html(`
            <div class="switch" style="float: right; width: 160px;margin-right: 16px;">
                <input type="radio" class="switch-input" name="view" value="week" id="switchWeek" checked="">
                <label for="switchWeek" class="switch-label switch-label-off">Week</label>
                <input type="radio" class="switch-input" name="view" value="month" id="switchMonth">
                <label for="switchMonth" class="switch-label switch-label-on">Month</label>
                <input type="radio" class="switch-input" name="view" value="quarter" id="switchQuarter">
                <label for="switchQuarter" class="switch-label switch-label-on">Qtr</label>
                <input type="radio" class="switch-input" name="view" value="year" id="switchYear">
                <label for="switchYear" class="switch-label switch-label-on">Year</label>
                <span class="switch-selection"></span>
            </div>`);

        $('#linkDetails fieldset').attr('onchange','refreshLinkCharts($(this))')

         $(`<style>
        /* Added by BetterAirlineClub plugin */
        .switch-input#switchQuarter:checked + .switch-label-on ~ .switch-selection { left: 80px; }
        .switch-input#switchYear:checked + .switch-label-on ~ .switch-selection { left: 120px; }
        </style>`).appendTo('head');
    }


    window.refreshLinkCharts = async function refreshLinkCharts(parentEl) {
        var _checkedElem = $('#linkDetails fieldset .switch input:checked')[0];

        $('#linkDetails fieldset .switch input').each((index, childElem) => {
            const same = childElem === _checkedElem;
            $(childElem).attr('checked', same);
        })

        window.plotUnit = plotUnit = plotUnitEnum[$(_checkedElem).val().toUpperCase() || 'MONTH'];

        var cycleCount = plotUnit.maxWeek
        const actionLinkId = $("#actionLinkId").val();
        const linkConsumptions = await _request(`airlines/${activeAirline.id}/link-consumptions/${actionLinkId}?cycleCount=${cycleCount}`);

        plotLinkCharts(linkConsumptions, plotUnit)
        $("#linkHistoryDetails").show();
    }

    window.plotLinkCharts = function plotLinkCharts(linkConsumptions, plotUnit = _getPlotUnit()) {
        plotLinkProfit(linkConsumptions, $("#linkProfitChart"), plotUnit)
        plotLinkConsumption(linkConsumptions, $("#linkRidershipChart"), $("#linkRevenueChart"), $("#linkPriceChart"), plotUnit)
    }

    window.plotLinkConsumption = function plotLinkConsumption(linkConsumptions, ridershipContainer, revenueContainer, priceContainer, plotUnit) {
        ridershipContainer.children(':FusionCharts').each((function(i) {
              $(this)[0].dispose();
        }))

        revenueContainer.children(':FusionCharts').each((function(i) {
              $(this)[0].dispose();
        }))

        priceContainer.children(':FusionCharts').each((function(i) {
              $(this)[0].dispose();
        }))

        var emptySeatsData = []
        var cancelledSeatsData = []
        var soldSeatsData = {
                economy : [],
                business : [],
                first : []
        }
        var revenueByClass = {
                economy : [],
                business : [],
                first : []
        }

        var priceByClass = {
            economy : [],
            business : [],
            first : []
        }



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


        if (!jQuery.isEmptyObject(linkConsumptions)) {
            linkConsumptions = $(linkConsumptions).toArray().slice(0, maxWeek)
            var hasCapacity = {} //check if there's any capacity for this link class at all
            hasCapacity.economy = $.grep(linkConsumptions, function(entry, index) {
                return entry.capacity.economy > 0
            }).length > 0
            hasCapacity.business = $.grep(linkConsumptions, function(entry, index) {
                return entry.capacity.business > 0
            }).length > 0
            hasCapacity.first = $.grep(linkConsumptions, function(entry, index) {
                return entry.capacity.first > 0
            }).length > 0

            $.each(linkConsumptions.reverse(), function(key, linkConsumption) {
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
                                        "xAxisname": xLabel,
                                        "YAxisName": "Seats Consumption",
                                        //"sYAxisName": "Load Factor %",
                                        "sNumberSuffix" : "%",
                                        "sYAxisMaxValue" : "100",
                                        "transposeAxis":"1",
                                        "useroundedges": "1",
                                        "animation": "0",
                                        "showBorder":"0",
                                          "toolTipBorderRadius": "2",
                                          "toolTipPadding": "5",
                                          "plotBorderAlpha": "10",
                                          "usePlotGradientColor": "0",
                                          "paletteColors": "#007849,#0375b4,#ffce00,#D46A6A,#bbbbbb",
                                          "bgAlpha":"0",
                                          "showValues":"0",
                                          "canvasPadding":"0",
                                          "labelDisplay":"wrap",
                                          "labelStep": weeksPerMark
                                    }

        checkDarkTheme(chartConfig, true)

        var ridershipChart = ridershipContainer.insertFusionCharts( {
            type: 'stackedarea2d',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity :'0',
            dataSource: {
                "chart": chartConfig,
                "categories" : [{ "category" : category}],
                "dataset" : [
                  {"seriesName": "Sold Seats (Economy)", "data" : soldSeatsData.economy}
                 ,{"seriesName": "Sold Seats (Business)","data" : soldSeatsData.business}
                 ,{"seriesName": "Sold Seats (First)", "data" : soldSeatsData.first}
                 ,{ "seriesName": "Cancelled Seats", "data" : cancelledSeatsData}
                 ,{ "seriesName": "Empty Seats", "data" : emptySeatsData}
                //, {"seriesName": "Load Factor", "renderAs" : "line", "parentYAxis": "S", "data" : loadFactorData}
                ]
            }
        })

        chartConfig = {
            "xAxisname": xLabel,
            "YAxisName": "Revenue",
            //"sYAxisName": "Load Factor %",
            "sYAxisMaxValue" : "100",
            "transposeAxis":"1",
            "useroundedges": "1",
            "numberPrefix": "$",
            "animation": "0",
            "showBorder":"0",
            "toolTipBorderRadius": "2",
            "toolTipPadding": "5",
            "plotBorderAlpha": "10",
            "usePlotGradientColor": "0",
            "paletteColors": "#007849,#0375b4,#ffce00",
            "bgAlpha":"0",
            "showValues":"0",
            "canvasPadding":"0",
            "labelDisplay":"wrap",
            "labelStep": weeksPerMark}

        checkDarkTheme(chartConfig, true)

        var revenueChart = revenueContainer.insertFusionCharts( {
            type: 'stackedarea2d',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity :'0',
            dataSource: {
                "chart": chartConfig,
                "categories" : [{ "category" : category}],
                "dataset" : [
                  {"seriesName": "Revenue (Economy)", "data" : revenueByClass.economy}
                 ,{"seriesName": "Revenue (Business)","data" : revenueByClass.business}
                 ,{"seriesName": "Revenue (First)", "data" : revenueByClass.first}
                ]
           }
        })

        chartConfig =  {
            "xAxisname": xLabel,
            "YAxisName": "Ticket Price",
            //"sYAxisName": "Load Factor %",
            "numberPrefix": "$",
            "sYAxisMaxValue" : "100",
            "useroundedges": "1",
            "transposeAxis":"1",
            "animation": "0",
            "showBorder":"0",
            "drawAnchors": "0",
              "toolTipBorderRadius": "2",
              "toolTipPadding": "5",
              "paletteColors": "#007849,#0375b4,#ffce00",
              "bgAlpha":"0",
              "showValues":"0",
              "canvasPadding":"0",
              "formatNumberScale" : "0",
              "labelDisplay":"wrap",
            "labelStep": weeksPerMark
        }

        checkDarkTheme(chartConfig, true)

        var priceChart = priceContainer.insertFusionCharts( {
            type: 'msline',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity :'0',
            dataSource: {
                "chart": chartConfig,
                "categories" : [{ "category" : category}],
                "dataset" : [
                              {"seriesName": "Price (Economy)", "data" : priceByClass.economy}
                             ,{"seriesName": "Price (Business)","data" : priceByClass.business}
                             ,{"seriesName": "Price (First)", "data" : priceByClass.first}
                            ]
           }
        })
    }

    function plotLinkProfit(linkConsumptions, container, plotUnit) {
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

        $.each(linkConsumptions, function(index, linkConsumption) {
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
        $.each(markOrder.reverse(), function(key, mark) {
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



    function _addAllianceTooltipsToMap(airportMarkers) {
        //now add extra listener for alliance airports
        $.each(airportMarkers, function(key, marker) {
            marker.addListener('mouseover', function(event) {
                closeAlliancePopups()
                var baseInfo = marker.baseInfo
                $("#allianceBasePopup .city").html(getCountryFlagImg(baseInfo.countryCode) + "&nbsp;" + baseInfo.city)
                $("#allianceBasePopup .airportName").text(baseInfo.airportName)
                $("#allianceBasePopup .iata").html(baseInfo.airportCode)
                $("#allianceBasePopup .airlineName").html(getAirlineLogoImg(baseInfo.airlineId) + "&nbsp;" + baseInfo.airlineName)
                $("#allianceBasePopup .baseScale").html(baseInfo.scale)

                var infoWindow = new google.maps.InfoWindow({ maxWidth : 1200});
                var popup = $("#allianceBasePopup").clone()
                popup.show()
                infoWindow.setContent(popup[0])
                //infoWindow.setPosition(event.latLng);
                infoWindow.open(map, marker);
                map.allianceBasePopup = infoWindow
            })

            marker.addListener('mouseout', function(event) {
                closeAlliancePopups()
            })
        })


        switchMap();
        $("#worldMapCanvas").data("initCallback", function() { //if go back to world map, re-init the map
            map.controls[google.maps.ControlPosition.TOP_CENTER].clear()
            clearAllPaths()
            updateAirportMarkers(activeAirline)
            updateLinksInfo() //redraw all flight paths
            closeAlliancePopups()
        })

        window.setTimeout(addExitButton , 1000); //delay otherwise it doesn't push to center
    }

    window.showAllianceMap = async function showAllianceMap() {
        clearAllPaths()
        deselectLink()

        var alliancePaths = []


        $('body .loadingSpinner').show()
        const result = await _request(`alliances/${selectedAlliance.id}/details`);
        $('body .loadingSpinner').hide()

        $.each(result.links, function(index, link) {
            alliancePaths.push(drawAllianceLink(link))
        })
        var allianceBases = []
         $.each(result.members, function(index, airline) {
            if (airline.role != "APPLICANT") {
                $.merge(allianceBases, airline.bases)
            }
        })

        window.lastAllianceInfo = {
            allianceBases,
            alliancePaths,
            updateAirportBaseMarkers: () => {
                var markers = updateAirportBaseMarkers(allianceBases, alliancePaths);
                _addAllianceTooltipsToMap(markers);
            }
        };
    }


    _updateLatestOilPriceInHeader();
};

$(document).ready(() => setTimeout(() => launch(), 1000));


// Begin Cost per PAX
// Begin Cost per PAX
// Begin Cost per PAX
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

window.updateAirplaneModelTable = function(sortProperty, sortOrder) {
    let distance = parseInt($("#flightRange").val(), 10);
    let runway = parseInt($("#runway").val(), 10);
    let min_capacity = parseInt($("#min_capacity").val(), 10);
    let min_circulation = parseInt($("#min_circulation").val(), 10);

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
                if (window.cachedTotalsById && Object.keys(window.cachedTotalsById).length === loadedModelsOwnerInfo.length) {
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
        var selectedSortHeader = $('#airplaneModelSortHeader .cell.selected')
        sortProperty = selectedSortHeader.data('sort-property')
        if (sortProperty === 'capacity') {
            sortProperty = 'max_capacity';
        } else if (sortProperty === 'cpp' && use_flight_total) {
            sortProperty = 'fuel_total';
        }
        sortOrder = selectedSortHeader.data('sort-order')
    }
    //sort the list
    loadedModelsOwnerInfo.sort(sortByProperty(sortProperty, sortOrder == "ascending"));

    var airplaneModelTable = $("#airplaneModelTable")
    airplaneModelTable.children("div.table-row").remove()

    var cppValues = loadedModelsOwnerInfo.filter(l => l.shouldShow).map(l => l.cpp);
    var cppMax = Math.max(...cppValues);
    var cppMin = Math.max(Math.min(...cppValues), 0);

    $.each(loadedModelsOwnerInfo, function(index, modelOwnerInfo) {
        if (!modelOwnerInfo.shouldShow) {
            return;
        }

        var row = $("<div class='table-row clickable' style='"+ (modelOwnerInfo.isOwned ? "background: green;" : '') +"' data-model-id='" + modelOwnerInfo.id + "' onclick='selectAirplaneModel(loadedModelsById[" + modelOwnerInfo.id + "])'></div>")
        if (modelOwnerInfo.isFavorite) {
            row.append("<div class='cell'>" + modelOwnerInfo.name + "<img src='assets/images/icons/heart.png' height='10px'></div>")
        } else {
            row.append("<div class='cell'>" + modelOwnerInfo.name + "</div>")
        }
        row.append("<div class='cell' style='text-overflow: ellipsis;text-wrap: nowrap;overflow: clip;' title='"+modelOwnerInfo.family+"'>" + modelOwnerInfo.family + "</div>")
        row.append("<div class='cell' align='right'>" + commaSeparateNumber(modelOwnerInfo.price) + "</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.capacity + " (" + (modelOwnerInfo.capacity * modelOwnerInfo.max_rotation) + ")</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.range + " km</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.fuelBurn + "</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.lifespan / 52 + " yrs</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.speed + " km/h</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.runwayRequirement + " m</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.assignedAirplanes.length + "/" + modelOwnerInfo.availableAirplanes.length + "/" + modelOwnerInfo.constructingAirplanes.length + "</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.max_rotation + "</div>")
        row.append("<div class='cell' align='right' style='"+ getStyleFromTier(getTierFromPercent(-1*modelOwnerInfo.cpp, -1*cppMax, -1*cppMin)) +"' title='"+commaSeparateNumber(Math.round(modelOwnerInfo.fuel_total))+"/total ("+commaSeparateNumber(Math.round(modelOwnerInfo.cpp * modelOwnerInfo.capacity))+"/flight)'>" + commaSeparateNumber(Math.round(modelOwnerInfo.cpp)) + "</div>")

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
        row.append("<div class='cell' align='right' style='"+ getStyleFromTier(discountTier) +"' >" + modelOwnerInfo.discountPercent + "</div>")
        row.append("<div class='cell' style='"+ (modelOwnerInfo.in_use >= MIN_PLANES_TO_HIGHLIGHT ? "text-shadow: gold 0px 0px 3px;" : '') +"'  align='right'>" + modelOwnerInfo.in_use + "</div>")


        if (selectedModelId == modelOwnerInfo.id) {
            row.addClass("selected")
            selectAirplaneModel(modelOwnerInfo)
        }
        airplaneModelTable.append(row)
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


$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Max flight rotations (uses user-set distance above)\" data-sort-property=\"max_rotation\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">⏲</div>");
$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Cost Per Pax\" data-sort-property=\"cpp\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">$/🧍</div>");
$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Discount Percent (influcenced by demand & brand loyalties)\" data-sort-property=\"discountPercent\" data-sort-order=\"descending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">%🔽</div>");
$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Total number in circulation (all players, game wide)\" data-sort-property=\"in_use\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">#✈</div>");

const headerCells = document.querySelectorAll('#airplaneModelSortHeader .cell');
for (var i = 0; i < headerCells.length; i++) {
    headerCells[i].style = `width: ${columnWidthPercents[i]}%`
}

$('#airplaneModelTable .table-header').html(`
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
`);

$("#airplaneCanvas .mainPanel .section .table .table-header:first").append(`
    <div class="cell detailsSelection">Distance: <input type="text" id="flightRange" value="${DEFAULT_MIN_FLIGHT_RANGE_FILTER}" /></div>
    <div class="cell detailsSelection">Runway length: <input type="text" id="runway" value="${DEFAULT_RUNWAY_LENGTH_FILTER}" /></div>
    <div class="cell detailsSelection">Min. Capacity: <input type="text" id="min_capacity" value="${DEFAULT_MIN_CAPACITY_FILTER}" /></div>
    <div class="cell detailsSelection">Min. Circulation: <input type="text" id="min_circulation" value="${DEFAULT_MIN_PLANES_IN_CIRCULATION_FILTER}" /></div>
    <div class="cell detailsSelection" style="min-width: 160px; text-align:right">
        <label for="owned_only">Owned Only <input type="checkbox" id="owned_only" /></label>
        <label for="use_flight_total">Flight Fuel Total <input type="checkbox" id="use_flight_total" /></label>
    </div>
`);


$("#airplaneCanvas .mainPanel .section .detailsGroup .market.details").attr({style: 'width: 100%; height: calc(100% - 30px); display: block;'});

$('[data-sort-property="totalOwned"]').text('Owned')
$('[data-sort-property="totalOwned"]').attr({style: 'width: 6%;'});


var newDataFilterElements = [
    '#flightRange',
    '#runway',
    '#min_capacity',
    '#min_circulation',
    '#owned_only',
    '#use_flight_total',
]

for (var el of newDataFilterElements) {
    $(el).change(function(){window.updateAirplaneModelTable()});
}

//* Link Cost Preview

let _updatePlanLinkInfo = window.updatePlanLinkInfo;
let _updateTotalValues = window.updateTotalValues;

window.latestActiveLink = null;

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

window.updateTotalValues = function(){
    _updateTotalValues();
    window.updateModelInfo(_modelId);
}

window.updatePlanLinkInfo = function(linkInfo){
    //console.log(linkInfo);
    window.latestActiveLink = activeLink = linkInfo;

    for (let model of activeLink.modelPlanLinkInfo){
        for (let airplane of model.airplanes){
            airplane.airplane.frequency = airplane.frequency;
        }
    }

    if (idFrom != linkInfo.fromAirportId){
        idFrom = linkInfo.fromAirportId
        $.ajax({
            url:"airports/" + linkInfo.fromAirportId,
            async : false,
            success: function(result){airportFrom = result},
        });
    }

    if (idTo != linkInfo.toAirportId){
        idTo = linkInfo.toAirportId
        $.ajax({
            url:"airports/" + linkInfo.toAirportId,
            async : false,
            success: function(result){airportTo = result},
        });
    }

    _updatePlanLinkInfo(linkInfo);
}

let _updateModelInfo = window.updateModelInfo;

window.updateModelInfo = function(modelId) {
    if (_modelId != modelId){
        _updateModelInfo(modelId);
    }
    _modelId = modelId;

    let model = loadedModelsById[modelId];
    let linkModel = activeLink.modelPlanLinkInfo.find(plane => plane.modelId == modelId);

    //console.log({loadedModelsById, model, linkModel})
    let serviceLevel = parseInt($("#planLinkServiceLevel").val());
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

    for (let row of $(".frequencyDetail .airplaneRow")) {
        let airplane = $(row).data("airplane");
        let freq = parseInt($(row).children(".frequency").val());
        let futureFreq = freq - airplane.frequency;
        let flightTime = freq * 2 * (linkModel.duration + model.turnaroundTime);

        let availableFlightMinutes = airplane.availableFlightMinutes - (futureFreq * 2 * (linkModel.duration + model.turnaroundTime));

        let utilisation = flightTime / (airplane.maxFlightMinutes - availableFlightMinutes);
        let planeUtilisation = (airplane.maxFlightMinutes - availableFlightMinutes) / airplane.maxFlightMinutes;

        let decayRate = 100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation);

        depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);

        maintenance += model.capacity * 100 * utilisation;

        frequency += freq;
    }

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

    $('#airplaneModelDetails #FCPF').text("$" + commaSeparateNumber(Math.floor(fuelCost)));
    $('#airplaneModelDetails #CCPF').text("$" + commaSeparateNumber(Math.floor(crewCost)));
    $('#airplaneModelDetails #AFPF').text("$" + commaSeparateNumber(airportFees));
    $('#airplaneModelDetails #depreciation').text("$" + commaSeparateNumber(Math.floor(depreciationRate)));
    $('#airplaneModelDetails #SSPF').text("$" + commaSeparateNumber(Math.floor(servicesCost)));
    $('#airplaneModelDetails #maintenance').text("$" + commaSeparateNumber(Math.floor(maintenance)));
    $('#airplaneModelDetails #cpp').text("$" + commaSeparateNumber(Math.floor(cost / (model.capacity * frequency))) + " * " + (model.capacity * frequency));
    $('#airplaneModelDetails #cps').text("$" + commaSeparateNumber(Math.floor(cost / staffTotal)) + " * " + staffTotal);
}

$("#airplaneModelDetails #speed").parent().after(`
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

$('#researchSearchResult > div.table.data.links > div.table-header').html(`
									  <div class="cell" style="width: 25%;"><h5>Airline</h5></div>
                                      <div class="cell" style="width: 25%;"><h5>Model</h5></div>
									  <div class="cell" style="width: 24%;"><h5>Price</h5></div>
									  <div class="cell" style="width: 20%;"><h5>Capacity</h5></div>
									  <div class="cell" style="width: 13%;"><h5>Quality</h5></div>
									  <div class="cell" style="width: 13%;"><h5>Freq.</h5></div>
								  `);
$("#researchSearchResult > div.table.data.links").after(`<select class="select-css" id="researchFlightModelSelect" onchange="researchUpdateModelInfo($(this).val())" style="margin: 10px auto; float: middle;"></select>
<div id="researchExtendedPanel" class="section" style="width: 50%; margin: 0px auto;">
							<div id="researchAirplaneModelDetails" style="width: 100%;" class="active">
								<div class="table">
									<h4>Airplane Model Details</h4>
									<div class="table-row">
										<div class="label"><h5>Model:</h5></div>
										<div class="value" id="modelName"></div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Family:</h5></div>
										<div class="value modelFamily"></div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Max Capacity:</h5></div>
										<div class="value" id="capacity"></div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Max Flying Range:</h5></div>
										<div class="value" id="range"></div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Fuel Burn:</h5></div>
										<div class="value" id="fuelBurn"></div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Category:</h5></div>
										<div class="value" id="airplaneType"></div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Turnaround Time:</h5></div>
										<div class="value"><span class="turnaroundTime"></span>&nbsp;min</div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Runway requirement:</h5></div>
										<div class="value"><span class="runwayRequirement"></span>&nbsp;m</div>
									</div>
									<div class="table-row">
										<div class="label"><h5>Speed:</h5></div>
										<div class="value" id="speed"></div>
									</div>
<div class="table-row">
    <div class="label">‍</div>
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
    <div class="label">‍</div>
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
						</div>`);
$("#airplaneModelDetails > div").before(`<select class="select-css" id="viewLinkModelSelect" onchange="linkUpdateModelInfo($(this).val())" style="margin: 10px auto; float: middle;"></select>`)
$("#ownedAirplaneDetail > div.table > div:nth-child(9) > div:nth-child(2)").html(`<span class="availableFlightMinutes"></span> Minute(s) / <span class="utilization"></span>% utilization`)

if (REMOVE_MOVING_BACKGROUND === true) {
    $('body').attr({style:`background: ${SOLID_BACKGROUND_COLOR};`});
}

console.log("Plane score script loaded");
