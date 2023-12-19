// ==UserScript==
// @name         BAC UP (with H/T/D/T)
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  try to take over the world!
// @author       Aphix/Torus (original cost per PAX by Alrianne), mdons, bohaska (Fly or die)
// @match        https://*.airline-club.com/
// @match        https://*.myfly.club/*
// @icon         https://www.google.com/s2/favicons?domain=airline-club.com
// @grant        none
// ==/UserScript==

(function () {
	"use strict";
	var debug = false;

	function reportAjaxError(jqXHR, textStatus, errorThrown) {
		console.error(JSON.stringify(jqXHR));
		console.error("AJAX error: " + textStatus + " : " + errorThrown);
		// throw errorThrown;
	}

	function _request(url, method = "GET", data = undefined) {
		return new Promise((resolve, reject) => {
			$.ajax({
				url,
				type: method,
				contentType: "application/json; charset=utf-8",
				data: data ? JSON.stringify(data) : data,
				dataType: "json",
				success: resolve,
				error: (...args) => {
					reportAjaxError(...args);
					reject(...args);
				},
			});
		});
	}

	function getFactorPercent(consumption, subType) {
		return consumption.capacity[subType] > 0 ? parseInt((consumption.soldSeats[subType] / consumption.capacity[subType]) * 100) : null;
	}

	function getLoadFactorsFor(consumption) {
		var factor = {};
		for (let key in consumption.capacity) {
			factor[key] = getFactorPercent(consumption, key) || "-";
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
		return array.map((obj) => _seekSubVal(obj, ...subKeys)).reduce((sum, val) => (sum += val || 0), 0) / array.length;
	}

	function _populateDerivedFieldsOnLink(link) {
		link.totalCapacity = link.capacity.economy + link.capacity.business + link.capacity.first;
		link.totalCapacityHistory = link.capacityHistory.economy + link.capacityHistory.business + link.capacityHistory.first;
		link.totalPassengers = link.passengers.economy + link.passengers.business + link.passengers.first;
		link.totalLoadFactor = link.totalCapacityHistory > 0 ? Math.round((link.totalPassengers / link.totalCapacityHistory) * 100) : 0;
		var assignedModel;
		if (link.assignedAirplanes && link.assignedAirplanes.length > 0) {
			assignedModel = link.assignedAirplanes[0].airplane.name;
		} else {
			assignedModel = "-";
		}
		link.model = assignedModel; //so this can be sorted

		link.profitMarginPercent = link.revenue === 0 ? 0 : ((link.profit + link.revenue) / link.revenue) * 100;

		link.profitMargin = link.profitMarginPercent > 100 ? link.profitMarginPercent - 100 : (100 - link.profitMarginPercent) * -1;

		link.profitPerPax = link.totalPassengers === 0 ? 0 : link.profit / link.totalPassengers;

		link.profitPerFlight = link.profit / link.frequency;
		link.profitPerHour = link.profit / link.duration;

		//log(link, true);
	}

	function plotHistory(linkConsumptions) {
		plotLinkCharts(linkConsumptions);
		$("#linkEventChart").data("linkConsumptions", linkConsumptions);
		$("#linkHistoryDetails").show();
	}

	function getShortModelName(airplaneName) {
		var sections = airplaneName.trim().split(" ").slice(1);

		return sections.map((str) => (str.includes("-") || str.length < 4 || /^[A-Z0-9\-]+[a-z]{0,4}$/.test(str) ? str : str[0].toUpperCase())).join(" ");
	}

	function getStyleFromTier(tier) {
		const stylesFromGoodToBad = [
			"color:#29FF66;",
			"color:#5AB874;",
			"color:inherit;",

			"color:#FA8282;",
			//'color:#FF3D3D;',
			//'color:#B30E0E;text-shadow:0px 0px 2px #CCC;',

			"color:#FF6969;",
			"color:#FF3D3D;font-weight: bold;",
			// 'color:#FF3D3D;text-decoration:underline',
		];

		return stylesFromGoodToBad[tier];
	}

	function getTierFromPercent(val, min = 0, max = 100) {
		var availableRange = max - min;
		var ranges = [0.95, 0.8, 0.75, 0.6, 0.5].map((multiplier) => availableRange * multiplier + min);

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

		$("#linkCompetitons .data-row").remove();
		$.each(linkConsumptions, function (index, linkConsumption) {
			var row = $(
				"<div class='table-row data-row'><div style='display: table-cell;'>" +
					linkConsumption.airlineName +
					"</div><div style='display: table-cell;'>" +
					toLinkClassValueString(linkConsumption.price, "$") +
					"</div><div style='display: table-cell; text-align: right;'>" +
					toLinkClassValueString(linkConsumption.capacity) +
					"</div><div style='display: table-cell; text-align: right;'>" +
					linkConsumption.quality +
					"</div><div style='display: table-cell; text-align: right;'>" +
					linkConsumption.frequency +
					"</div></div>"
			);

			if (linkConsumption.airlineId == airlineId) {
				$("#linkCompetitons .table-header").after(row); //self is always on top
			} else {
				$("#linkCompetitons").append(row);
			}
		});

		if ($("#linkCompetitons .data-row").length == 0) {
			$("#linkCompetitons").append(
				"<div class='table-row data-row'><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div></div>"
			);
		}

		$("#linkCompetitons").show();

		assignAirlineColors(linkConsumptions, "airlineId");

		plotPie(linkConsumptions, null, $("#linkCompetitionsPie"), "airlineName", "soldSeats");

		return linkConsumptions;
	}

	function _isFullPax(link, key) {
		return link.passengers[key] === link.capacity[key];
	}

	function _getPricesFor(link) {
		var linkPrices = {};
		for (var key in link.price) {
			if (key === "total") continue;

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
			rawQuality: link.rawQuality,
		};

		for (var p of link.assignedAirplanes) {
			if (!p.frequency) continue;

			priceUpdate.airplanes[p.airplane.id] = p.frequency;
		}

		log({ req: priceUpdate }, true);
		const updateResult = await _request(`/airlines/${priceUpdate.airlineId}/links`, "PUT", priceUpdate);

		log({ updateResult }, true);
	}

	//load history
	async function loadHistoryForLink(airlineId, linkId, cycleCount, link) {
		const linkHistory = await _request(`airlines/${airlineId}/link-consumptions/${linkId}?cycleCount=${cycleCount}`);

		if (jQuery.isEmptyObject(linkHistory)) {
			$("#linkHistoryPrice").text("-");
			$("#linkHistoryCapacity").text("-");
			$("#linkLoadFactor").text("-");
			$("#linkProfit").text("-");
			$("#linkRevenue").text("-");
			$("#linkFuelCost").text("-");
			$("#linkCrewCost").text("-");
			$("#linkAirportFees").text("-");
			$("#linkDepreciation").text("-");
			$("#linkCompensation").text("-");
			$("#linkLoungeCost").text("-");
			$("#linkServiceSupplies").text("-");
			$("#linkMaintenance").text("-");
			$("#linkOtherCosts").text("-");
			$("#linkDelays").text("-");
			$("#linkCancellations").text("-");

			disableButton($("#linkDetails .button.viewLinkHistory"), "Passenger Map is not yet available for this route - please wait for the simulation (time estimation on top left of the screen).");
			disableButton(
				$("#linkDetails .button.viewLinkComposition"),
				"Passenger Survey is not yet available for this route - please wait for the simulation (time estimation on top left of the screen)."
			);

			plotHistory(linkHistory);
			return;
		}

		if (!$("#linkAverageLoadFactor").length) {
			$("#linkLoadFactor").parent().after(`<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Load Factor:</h5></div>
            <div class="value" id="linkAverageLoadFactor"></div>
        </div>`);
		}

		if (!$("#linkAverageProfit").length) {
			$("#linkProfit").parent().after(`<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Profit:</h5></div>
            <div class="value" id="linkAverageProfit"></div>
        </div>`);
		}

		//if (!$("#doAutomaticPriceUpdate").length) {
		//    $("#linkLoadFactor").parent().after(`<div class="table-row" style="color:#999">
		//        <div class="button" id="doAutomaticPriceUpdate">Auto Manage</div>
		//    </div>`)
		//}

		const averageLoadFactor = getLoadFactorsFor({
			soldSeats: {
				economy: averageFromSubKey(linkHistory, "soldSeats", "economy"),
				business: averageFromSubKey(linkHistory, "soldSeats", "business"),
				first: averageFromSubKey(linkHistory, "soldSeats", "first"),
			},
			capacity: {
				economy: averageFromSubKey(linkHistory, "capacity", "economy"),
				business: averageFromSubKey(linkHistory, "capacity", "business"),
				first: averageFromSubKey(linkHistory, "capacity", "first"),
			},
		});

		var latestLinkData = linkHistory[0];
		$("#linkHistoryPrice").text(toLinkClassValueString(latestLinkData.price, "$"));
		$("#linkHistoryCapacity").text(toLinkClassValueString(latestLinkData.capacity));

		if (latestLinkData.totalLoadFactor !== 100) {
			let originalLink = link;
			log(originalLink, true);
			$("#doAutomaticPriceUpdate").click(() => {
				_doAutomaticPriceUpdateFor(originalLink);
			});

			$("#doAutomaticPriceUpdate").show();
		} else {
			$("#doAutomaticPriceUpdate").hide();
		}

		$("#linkLoadFactor").text(toLinkClassValueString(getLoadFactorsFor(latestLinkData), "", "%"));
		$("#linkAverageLoadFactor").text(toLinkClassValueString(averageLoadFactor, "", "%"));

		const dollarValuesByElementId = {
			linkProfit: latestLinkData.profit,
			linkAverageProfit: Math.round(averageFromSubKey(linkHistory, "profit")),
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
			$("#" + elementId).text("$" + commaSeparateNumber(dollarValuesByElementId[elementId]));
		}

		if (latestLinkData.minorDelayCount == 0 && latestLinkData.majorDelayCount == 0) {
			$("#linkDelays").removeClass("warning");
			$("#linkDelays").text("-");
		} else {
			$("#linkDelays").addClass("warning");
			$("#linkDelays").text(latestLinkData.minorDelayCount + " minor " + latestLinkData.majorDelayCount + " major");
		}

		if (latestLinkData.cancellationCount == 0) {
			$("#linkCancellations").removeClass("warning");
			$("#linkCancellations").text("-");
		} else {
			$("#linkCancellations").addClass("warning");
			$("#linkCancellations").text(latestLinkData.cancellationCount);
		}
		enableButton($("#linkDetails .button.viewLinkHistory"));
		enableButton($("#linkDetails .button.viewLinkComposition"));

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
<span class="tooltiptext below" style="white-space: nowrap;">B: Budget pax (Cares about price)<br>S: Swift pax (Cares about frequency)<br>L: Compehensive + Brand Aware + Elite pax (Cares about quality & loyalty)<br>L pax are 3x better at generating loyalists compared to B and S pax<br>Check the survey button for more info on pax types
<br></span>
</div>
            </h5>
            </div>
            <div class="value" id="paxType"></div>
        </div>`);
		};
        $("#paxOrigin").text(``);
        $("#paxType").text(``);
        const survey = await _request(`airlines/${airlineId}/link-composition/${link.id}`);
        const passengerMap = await _request(`airlines/${airlineId}/related-link-consumption/${link.id}?cycleDelta=0&economy=true&business=true&first=true`);
        var homeAirportPax = 0;
        var destinationAirportPax = 0;
        var homeTransitPax = 0;
        var destinationTransitPax = 0;
        var budgetPax = 0;
        var swiftPax = 0;
        var loyalistPax = 0;
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
                budgetPax += survey.preferenceType[i].passengerCount
            } else {
                if (survey.preferenceType[i].title === "Swift") {
                    swiftPax += survey.preferenceType[i].passengerCount
                } else {
                    if (["Comprehensive", "Brand Conscious", "Elite"].includes(survey.preferenceType[i].title)) {
                        loyalistPax += survey.preferenceType[i].passengerCount
                    }
                }
            }
        }
        $("#paxOrigin").text(`${homeAirportPax}/${homeTransitPax}/${destinationAirportPax}/${destinationTransitPax}`);
        $("#paxType").text(`${budgetPax}/${swiftPax}/${loyalistPax}`);
    }

	async function loadLink(airlineId, linkId) {
		const link = await _request(`airlines/${airlineId}/links/${linkId}`);

		$("#linkFromAirport")
			.attr("onclick", "showAirportDetails(" + link.fromAirportId + ")")
			.html(getCountryFlagImg(link.fromCountryCode) + getAirportText(link.fromAirportCity, link.fromAirportCode));
		//$("#linkFromAirportExpectedQuality").attr("onclick", "loadLinkExpectedQuality(" + link.fromAirportId + "," + link.toAirportId + "," + link.fromAirportId + ")")
		$("#linkToAirport")
			.attr("onclick", "showAirportDetails(" + link.toAirportId + ")")
			.html(getCountryFlagImg(link.toCountryCode) + getAirportText(link.toAirportCity, link.toAirportCode));
		//$("#linkToAirportExpectedQuality").attr("onclick", "loadLinkExpectedQuality(" + link.fromAirportId + "," + link.toAirportId + "," + link.toAirportId + ")")
		$("#linkFlightCode").text(link.flightCode);
		if (link.assignedAirplanes && link.assignedAirplanes.length > 0) {
			$("#linkAirplaneModel").text(link.assignedAirplanes[0].airplane.name + "(" + link.assignedAirplanes.length + ")");
		} else {
			$("#linkAirplaneModel").text("-");
		}
		$("#linkCurrentPrice").text(toLinkClassValueString(link.price, "$"));
		$("#linkDistance").text(link.distance + " km (" + link.flightType + ")");
		$("#linkQuality").html(getGradeStarsImgs(Math.round(link.computedQuality / 10)) + link.computedQuality);
		$("#linkCurrentCapacity").text(toLinkClassValueString(link.capacity));
		if (link.future) {
			$("#linkCurrentDetails .future .capacity").text(toLinkClassValueString(link.future.capacity));
			$("#linkCurrentDetails .future").show();
		} else {
			$("#linkCurrentDetails .future").hide();
		}
		$("#linkCurrentDetails").show();

		$("#linkToAirportId").val(link.toAirportId);
		$("#linkFromAirportId").val(link.fromAirportId);

		const plotUnit = $("#linkDetails #switchMonth").is(":checked") ? window.plotUnitEnum.MONTH : window.plotUnitEnum.QUARTER;
		const cycleCount = plotUnit.maxWeek;

		const [linkCompetition, linkHistory, linkSurvey] = await Promise.all([loadCompetitionForLink(airlineId, link), loadHistoryForLink(airlineId, linkId, cycleCount, link), loadLinkSurvey(airlineId, link)]);

		$("#linkEventModal").data("link", link);

		return {
			link,
			linkCompetition,
			linkHistory,
		};
	}

	async function _updateLatestOilPriceInHeader() {
		const oilPrices = await _request("oil-prices");
		const latestPrice = oilPrices.slice(-1)[0].price;

		if (!$(".topBarDetails .latestOilPriceShortCut").length) {
			$(".topBarDetails .delegatesShortcut").after(`
            <span style="margin: 0px 10px; padding: 0 5px"  title="Latest Oil Price" class="latestOilPriceShortCut clickable" onclick="showOilCanvas()">
                <span class="latest-price label" style=""></span>
            </span>
        `);
		}

		const tierForPrice = 5 - getTierFromPercent(latestPrice, 40, 80);

		if (tierForPrice < 2) {
			$(".latestOilPriceShortCut").addClass("glow").addClass("button");
		} else {
			$(".latestOilPriceShortCut").removeClass("glow").removeClass("button");
		}

		$(".topBarDetails .latest-price")
			.text("$" + commaSeparateNumber(latestPrice))
			.attr({ style: getStyleFromTier(tierForPrice) });

		setTimeout(() => {
			_updateLatestOilPriceInHeader();
		}, Math.round(Math.max(durationTillNextTick / 2, 30000)));
	}

	function commaSeparateNumberForLinks(val) {
		const over1k = val > 1000 || val < -1000;
		const isNegative = val < 0;

		if (val !== 0) {
			const withDecimal = Math.abs(over1k ? val / 1000 : val);
			const remainderTenths = Math.round((withDecimal % 1) * 10) / 10;
			val = Math.floor(withDecimal) + remainderTenths;

			while (/(\d+)(\d{3})/.test(val.toString())) {
				val = val.toString().replace(/(\d+)(\d{3})/, "$1" + "," + "$2");
			}
		}

		const valWithSuffix = over1k ? val + "k" : val;

		return isNegative ? "(" + valWithSuffix + ")" : valWithSuffix;
	}

	function launch() {
		window.plotUnitEnum = {
			MONTH: {
				value: 1,
				maxWeek: 104,
				weeksPerMark: 4,
				maxMark: 28,
			},
			QUARTER: {
				value: 2,
				maxWeek: 208,
				weeksPerMark: 8,
				maxMark: 52,
			},
		};

		window.commaSeparateNumberForLinks = commaSeparateNumberForLinks;

		var cachedTotalsById = {};

		window.loadAirplaneModelStats = async function loadAirplaneModelStats(modelInfo, opts = {}) {
			var url;
			var favoriteIcon = $("#airplaneModelDetail .favorite");
			var model = loadedModelsById[modelInfo.id];
			if (activeAirline) {
				(url = "airlines/" + activeAirline.id + "/airplanes/model/" + model.id + "/stats"), favoriteIcon.show();
			} else {
				url = "airplane-models/" + model.id + "/stats";
				favoriteIcon.hide();
			}

			if (opts && opts.totalOnly && model.in_use && model.in_use !== -1) {
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

			updateTopOperatorsTable(stats);
			$("#airplaneCanvas .total").text(stats.total);

			cachedTotalsById[model.id] = model.in_use = stats.total;

			if (stats.favorite === undefined) {
				return;
			}

			favoriteIcon.off(); //remove all listeners

			if (stats.favorite.rejection) {
				$("#setFavoriteModal").data("rejection", stats.favorite.rejection);
			} else {
				$("#setFavoriteModal").removeData("rejection");
			}

			if (modelInfo.isFavorite) {
				favoriteIcon.attr("src", "assets/images/icons/heart.png");
				$("#setFavoriteModal").data("rejection", "This is already the Favorite");
			} else {
				favoriteIcon.attr("src", "assets/images/icons/heart-empty.png");
			}

			$("#setFavoriteModal").data("model", model);
		};

		window.updateCustomLinkTableHeader = function updateCustomLinkTableHeader() {
			if ($("#linksTableSortHeader").children().length === 15) {
				return;
			}

			$("#linksCanvas .mainPanel").css({ width: "62%" });
			$("#linksCanvas .sidePanel").css({ width: "38%" });

			$("#canvas .mainPanel").css({ width: "62%" });
			$("#canvas .sidePanel").css({ width: "38%" });

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
				console.warn(`Column widths to not add up to 100: ${sum} (${widths.join(",")}) -- ${sum < 100 ? "Remaining" : "Over by"}: ${sum < 100 ? 100 - sum : sum - 100}%`);
			}

			$("#linksTableSortHeader").html(`
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

			$("#linksTable .table-header").html(`
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
		};

		window.loadLinksTable = async function loadLinksTable() {
			const links = await _request(`airlines/${activeAirline.id}/links-details`);

			updateCustomLinkTableHeader();
			updateLoadedLinks(links);

			$.each(links, (key, link) => _populateDerivedFieldsOnLink(link));

			var selectedSortHeader = $("#linksTableSortHeader .cell.selected");
			updateLinksTable(selectedSortHeader.data("sort-property"), selectedSortHeader.data("sort-order"));
		};

		var colorKeyMaps = {};
		window.updateLinksTable = function updateLinksTable(sortProperty, sortOrder) {
			var linksTable = $("#linksCanvas #linksTable");
			linksTable.children("div.table-row").remove();

			loadedLinks = sortPreserveOrder(loadedLinks, sortProperty, sortOrder == "ascending");

			function getKeyedStyleFromLink(link, keyName, ...args) {
				if (!colorKeyMaps[keyName]) {
					colorKeyMaps[keyName] = new WeakMap();
				} else if (colorKeyMaps[keyName].has(link)) {
					return colorKeyMaps[keyName].get(link);
				}

				var data = loadedLinks.map((l) => l[keyName]);

				var avg = data.reduce((sum, acc) => (sum += acc), 0) / loadedLinks.length;
				var max = Math.max(...data);
				var min = Math.max(Math.min(...data), 0);

				var tier = getTierFromPercent(link[keyName], args[0] !== undefined ? args[0] : min, args[1] || avg * 0.618);
				if (!link.tiers) {
					link.tiers = {};
				}

				link.tiers[keyName] = tier;

				var colorResult = getStyleFromTier(tier);

				colorKeyMaps[keyName].set(link, colorResult);

				return colorResult;
			}

			$.each(loadedLinks, function (index, link) {
				var row = $("<div class='table-row clickable' onclick='selectLinkFromTable($(this), " + link.id + ")'></div>");

				var srcAirportFull = getAirportText(link.fromAirportCity, link.fromAirportCode);
				var destAirportFull = getAirportText(link.toAirportCity, link.toAirportCode);

				//                 COMMENT one set or the other to test both:
				// Truncated
				//
				row.append("<div class='cell' title='" + srcAirportFull + "'>" + getCountryFlagImg(link.fromCountryCode) + " " + srcAirportFull.slice(-4, -1) + "</div>");
				row.append("<div class='cell' title='" + destAirportFull + "'>" + getCountryFlagImg(link.toCountryCode) + " " + destAirportFull.slice(-4, -1) + "</div>");
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

				row.append("<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;'>" + getShortModelName(link.model) + "</div>");
				row.append("<div class='cell' align='right'>" + link.distance + "km</div>");
				row.append("<div class='cell' align='right'>" + link.totalCapacity + " (" + link.frequency + ")</div>");
				row.append("<div class='cell' align='right'>" + link.totalPassengers + "</div>");

				// row.append("<div style='"+getKeyedStyleFromLink(link, 'totalLoadFactor', 0, 100)+"' class='cell' align='right'>" + link.totalLoadFactor + '%' + "</div>")
				const lfBreakdown = {
					economy: link.passengers.economy / link.capacity.economy,
					business: link.passengers.business / link.capacity.business,
					first: link.passengers.first / link.capacity.first,
				};

				let lfBreakdownText = link.totalLoadFactor === 100 ? "100" : [lfBreakdown.economy, lfBreakdown.business, lfBreakdown.first].map((v) => (v ? Math.floor(100 * v) : "-")).join("/");

				row.append("<div style='" + getKeyedStyleFromLink(link, "totalLoadFactor", 0, 100) + "' class='cell' align='right'>" + lfBreakdownText + "%" + "</div>");

				row.append("<div style='" + getKeyedStyleFromLink(link, "satisfaction", 0, 1) + "' class='cell' align='right'>" + Math.round(link.satisfaction * 100) + "%" + "</div>");
				row.append(
					"<div style='" +
						getKeyedStyleFromLink(link, "revenue") +
						"'  class='cell' align='right' title='$" +
						commaSeparateNumber(link.revenue) +
						"'>" +
						"$" +
						commaSeparateNumberForLinks(link.revenue) +
						"</div>"
				);
				row.append(
					"<div style='" +
						getKeyedStyleFromLink(link, "profit") +
						"'  class='cell' align='right' title='$" +
						commaSeparateNumber(link.profit) +
						"'>" +
						"$" +
						commaSeparateNumberForLinks(link.profit) +
						"</div>"
				);

				//row.append("<div style='color:"+textColor+";' class='cell' align='right'>" + (link.profitMargin > 0 ? '+' : '') + Math.round(link.profitMargin) + "%</div>")
				row.append(
					"<div style='" +
						getKeyedStyleFromLink(link, "profitMarginPercent", 0, 136.5) +
						"' class='cell' align='right'>" +
						(link.profitMargin > 0 ? "+" : "") +
						Math.round(link.profitMargin) +
						"%</div>"
				);

				row.append(
					"<div style='" +
						getKeyedStyleFromLink(link, "profitPerPax") +
						"' class='cell' align='right' title='$" +
						commaSeparateNumber(link.profitPerPax) +
						"'>" +
						"$" +
						commaSeparateNumberForLinks(link.profitPerPax) +
						"</div>"
				);
				row.append(
					"<div style='" +
						getKeyedStyleFromLink(link, "profitPerFlight") +
						"' class='cell' align='right' title='$" +
						commaSeparateNumber(link.profitPerFlight) +
						"'>" +
						"$" +
						commaSeparateNumberForLinks(link.profitPerFlight) +
						"</div>"
				);
				row.append(
					"<div style='" +
						getKeyedStyleFromLink(link, "profitPerHour") +
						"' class='cell' align='right' title='$" +
						commaSeparateNumber(link.profitPerHour) +
						"'>" +
						"$" +
						commaSeparateNumberForLinks(link.profitPerHour) +
						"</div>"
				);

				if (selectedLink == link.id) {
					row.addClass("selected");
				}

				const tiersRank = (link.tiersRank = Object.keys(link.tiers).reduce((sum, key) => sum + link.tiers[key] + (key === "profit" && link.tiers[key] === 0 ? -1 : 0), 0));

				row.prepend("<div class='cell'>" + link.tiersRank + "</div>");

				if (tiersRank < 2) {
					row.css({ "text-shadow": "0 0 3px gold" });
				}

				if (tiersRank > 27) {
					row.css({ "text-shadow": "0 0 3px red" });
				}

				linksTable.append(row);
			});
		};

		window.refreshLinkDetails = async function refreshLinkDetails(linkId) {
			const airlineId = activeAirline.id;

			$("#linkCompetitons .data-row").remove();
			$("#actionLinkId").val(linkId);

			// load link
			const linkDetailsPromise = loadLink(airlineId, linkId); // not awaiting yet so we can kickoff the panel open animation while loading

			setActiveDiv($("#linkDetails"));
			hideActiveDiv($("#extendedPanel #airplaneModelDetails"));
			$("#sidePanel").fadeIn(200);

			const { link, linkCompetition, linkHistory } = await linkDetailsPromise; // link details loaded if needed for something later
		};

		function _addAllianceTooltipsToMap(airportMarkers) {
			//now add extra listener for alliance airports
			$.each(airportMarkers, function (key, marker) {
				marker.addListener("mouseover", function (event) {
					closeAlliancePopups();
					var baseInfo = marker.baseInfo;
					$("#allianceBasePopup .city").html(getCountryFlagImg(baseInfo.countryCode) + "&nbsp;" + baseInfo.city);
					$("#allianceBasePopup .airportName").text(baseInfo.airportName);
					$("#allianceBasePopup .iata").html(baseInfo.airportCode);
					$("#allianceBasePopup .airlineName").html(getAirlineLogoImg(baseInfo.airlineId) + "&nbsp;" + baseInfo.airlineName);
					$("#allianceBasePopup .baseScale").html(baseInfo.scale);

					var infoWindow = new google.maps.InfoWindow({ maxWidth: 1200 });
					var popup = $("#allianceBasePopup").clone();
					popup.show();
					infoWindow.setContent(popup[0]);
					//infoWindow.setPosition(event.latLng);
					infoWindow.open(map, marker);
					map.allianceBasePopup = infoWindow;
				});

				marker.addListener("mouseout", function (event) {
					closeAlliancePopups();
				});
			});

			switchMap();
			$("#worldMapCanvas").data("initCallback", function () {
				//if go back to world map, re-init the map
				map.controls[google.maps.ControlPosition.TOP_CENTER].clear();
				clearAllPaths();
				updateAirportMarkers(activeAirline);
				updateLinksInfo(); //redraw all flight paths
				closeAlliancePopups();
			});

			window.setTimeout(addExitButton, 1000); //delay otherwise it doesn't push to center
		}

		window.showAllianceMap = async function showAllianceMap() {
			clearAllPaths();
			deselectLink();

			var alliancePaths = [];

			$("body .loadingSpinner").show();
			const result = await _request(`alliances/${selectedAlliance.id}/details`);
			$("body .loadingSpinner").hide();

			$.each(result.links, function (index, link) {
				alliancePaths.push(drawAllianceLink(link));
			});
			var allianceBases = [];
			$.each(result.members, function (index, airline) {
				if (airline.role != "APPLICANT") {
					$.merge(allianceBases, airline.bases);
				}
			});

			window.lastAllianceInfo = {
				allianceBases,
				alliancePaths,
				updateAirportBaseMarkers: () => {
					var markers = updateAirportBaseMarkers(allianceBases, alliancePaths);
					_addAllianceTooltipsToMap(markers);
				},
			};
		};

		_updateLatestOilPriceInHeader();
	}

	$(document).ready(() => setTimeout(() => launch(), 1000));

	// Begin Cost per PAX

	log("Plane score script loading");

	function calcFlightTime(plane, distance) {
		let min = Math.min;
		let max = Math.max;
		let speed = plane.speed * (plane.airplaneType.toUpperCase() == "SUPERSONIC" ? 1.5 : 1);
		let a = min(distance, 300);
		let b = min(max(0, distance - a), 400);
		let c = min(max(0, distance - (a + b)), 400);
		let d = max(0, distance - (a + b + c));

		let time_flight = a / min(speed, 350) + b / min(speed, 500) + c / min(speed, 700) + d / speed;
		return time_flight * 60;
	}

	function calcFuelBurn(plane, distance) {
		let timeFlight = calcFlightTime(plane, distance);
		if (timeFlight > 90) {
			return plane.fuelBurn * (405 + timeFlight);
		} else {
			return plane.fuelBurn * timeFlight * 5.5;
		}
	}

	window.updateAirplaneModelTable = function (sortProperty, sortOrder) {
		let distance = parseInt($("#fightRange").val(), 10);
		let runway = parseInt($("#runway").val(), 10);
		let min_capacity = parseInt($("#min_capacity").val(), 10);
		let min_circulation = parseInt($("#min_circulation").val(), 10);

		let owned_only = document.getElementById("owned_only").checked;
		let use_flight_total = document.getElementById("use_flight_total").checked;

		for (let plane of loadedModelsOwnerInfo) {
			if (plane.range < distance || plane.runwayRequirement > runway) {
				plane.cpp = -1;
				plane.max_rotation = -1;
				continue;
			}
			var plane_category = -1;

			switch (plane.airplaneType.toUpperCase()) {
				case "LIGHT":
				case "SMALL":
					plane_category = 1;
					break;
				case "REGIONAL":
					plane_category = 3;
					break;
				case "MEDIUM":
					plane_category = 8;
					break;
				case "LARGE":
					plane_category = 12;
					break;
				case "EXTRA LARGE":
				case "X_LARGE":
					plane_category = 15;
					break;
				case "JUMBO":
					plane_category = 18;
					break;
				case "SUPERSONIC":
					plane_category = 12;
					break;
			}

			let flightDuration = calcFlightTime(plane, distance);
			let price = plane.price;
			if (plane.originalPrice) {
				price = plane.originalPrice;
			}

			let maxFlightMinutes = 4 * 24 * 60;
			let frequency = Math.floor(maxFlightMinutes / ((flightDuration + plane.turnaroundTime) * 2));

			let flightTime = frequency * 2 * (flightDuration + plane.turnaroundTime);
			let availableFlightMinutes = maxFlightMinutes - flightTime;
			let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
			let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

			let decayRate = (100 / (plane.lifespan * 3)) * (1 + 2 * planeUtilisation);
			let depreciationRate = Math.floor(price * (decayRate / 100) * utilisation);
			let maintenance = plane.capacity * 100 * utilisation;

			let airport_fee = (500 * plane_category + plane.capacity * 10) * 2;
			let crew_cost = plane.capacity * (flightDuration / 60) * 12;
			let inflight_cost = (20 + (8 * flightDuration) / 60) * plane.capacity * 2;

			plane.max_rotation = frequency;
			plane.fbpf = calcFuelBurn(plane, distance);
			plane.fbpp = plane.fbpf / plane.capacity;
			plane.fbpw = plane.fbpf * plane.max_rotation;
			plane.fuel_total = (plane.fbpf * 0.08 + airport_fee + inflight_cost + crew_cost) * plane.max_rotation + depreciationRate + maintenance;
			plane.cpp = plane.fuel_total / (plane.capacity * plane.max_rotation);
			plane.max_capacity = plane.capacity * plane.max_rotation;

			if (!plane.in_use) {
				plane.in_use = -1;
				loadAirplaneModelStats(plane, { totalOnly: true });
			}
		}

		if (!sortProperty && !sortOrder) {
			var selectedSortHeader = $("#airplaneModelSortHeader .cell.selected");
			sortProperty = selectedSortHeader.data("sort-property");
			if (sortProperty === "capacity") {
				sortProperty = "max_capacity";
			} else if (sortProperty === "cpp" && use_flight_total) {
				sortProperty = "fuel_total";
			}
			sortOrder = selectedSortHeader.data("sort-order");
		}
		//sort the list
		loadedModelsOwnerInfo.sort(sortByProperty(sortProperty, sortOrder == "ascending"));

		var airplaneModelTable = $("#airplaneModelTable");
		airplaneModelTable.children("div.table-row").remove();

		$.each(loadedModelsOwnerInfo, function (index, modelOwnerInfo) {
			var isOwned = modelOwnerInfo.assignedAirplanes.length + modelOwnerInfo.availableAirplanes.length + modelOwnerInfo.constructingAirplanes.length !== 0;
			if (modelOwnerInfo.cpp === -1 || modelOwnerInfo.max_capacity < min_capacity || (modelOwnerInfo.in_use < min_circulation && !isOwned) || (owned_only && !isOwned)) {
				return;
			}

			var row = $(
				"<div class='table-row clickable' style='" +
					(isOwned ? "background: green;" : "") +
					"' data-model-id='" +
					modelOwnerInfo.id +
					"' onclick='selectAirplaneModel(loadedModelsById[" +
					modelOwnerInfo.id +
					"])'></div>"
			);
			if (modelOwnerInfo.isFavorite) {
				row.append("<div class='cell'>" + modelOwnerInfo.name + "<img src='assets/images/icons/heart.png' height='10px'></div>");
			} else {
				row.append("<div class='cell'>" + modelOwnerInfo.name + "</div>");
			}
			row.append("<div class='cell'>" + modelOwnerInfo.family + "</div>");
			row.append("<div class='cell' align='right'>" + commaSeparateNumber(modelOwnerInfo.price) + "</div>");
			row.append("<div class='cell' align='right'>" + modelOwnerInfo.capacity + " (" + modelOwnerInfo.capacity * modelOwnerInfo.max_rotation + ")</div>");
			row.append("<div class='cell' align='right'>" + modelOwnerInfo.range + " km</div>");
			row.append("<div class='cell' align='right'>" + modelOwnerInfo.fuelBurn + "</div>");
			row.append("<div class='cell' align='right'>" + modelOwnerInfo.lifespan / 52 + " yrs</div>");
			row.append("<div class='cell' align='right'>" + modelOwnerInfo.speed + " km/h</div>");
			row.append("<div class='cell' align='right'>" + modelOwnerInfo.runwayRequirement + " m</div>");
			row.append(
				"<div class='cell' align='right'>" + modelOwnerInfo.assignedAirplanes.length + "/" + modelOwnerInfo.availableAirplanes.length + "/" + modelOwnerInfo.constructingAirplanes.length + "</div>"
			);
			row.append("<div class='cell' align='right'>" + modelOwnerInfo.max_rotation + "</div>");
			row.append(
				"<div class='cell' align='right' title='" +
					commaSeparateNumber(Math.round(modelOwnerInfo.fuel_total)) +
					"/total (" +
					commaSeparateNumber(Math.round(modelOwnerInfo.cpp * modelOwnerInfo.capacity)) +
					"/flight)'>" +
					commaSeparateNumber(Math.round(modelOwnerInfo.cpp)) +
					"</div>"
			);
			row.append("<div class='cell' style='" + (modelOwnerInfo.in_use >= 500 ? "text-shadow: gold 0px 0px 3px;" : "") + "'  align='right'>" + modelOwnerInfo.in_use + "</div>");

			if (selectedModelId == modelOwnerInfo.id) {
				row.addClass("selected");
				selectAirplaneModel(modelOwnerInfo);
			}
			airplaneModelTable.append(row);
		});
	};

	const columnWidthPercents = [17, 12, 9, 7, 7, 7, 7, 9, 7, 6, 3, 5, 4];

	if (columnWidthPercents.reduce((sum, val) => (sum += val), 0) !== 100) {
		console.warn("Column widths do not equal 100%, widths:", columnWidthPercents);
	}

	$("#airplaneModelSortHeader").append(
		'<div class="cell clickable" data-sort-property="max_rotation" data-sort-order="ascending" onclick="toggleAirplaneModelTableSortOrder($(this))" align="right">⏲</div>'
	);
	$("#airplaneModelSortHeader").append(
		'<div class="cell clickable" data-sort-property="cpp" data-sort-order="ascending" onclick="toggleAirplaneModelTableSortOrder($(this))" align="right">$/🧍</div>'
	);
	$("#airplaneModelSortHeader").append(
		'<div class="cell clickable" data-sort-property="in_use" data-sort-order="ascending" onclick="toggleAirplaneModelTableSortOrder($(this))" align="right">#✈</div>'
	);

	const headerCells = document.querySelectorAll("#airplaneModelSortHeader .cell");
	for (var i = 0; i < headerCells.length; i++) {
		headerCells[i].style = `width: ${columnWidthPercents[i]}%`;
	}

	$("#airplaneModelTable .table-header").html(`
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
`);

	$("#airplaneCanvas .mainPanel .section .table .table-header:first").append(`
    <div class="cell detailsSelection">Distance: <input type="text" id="fightRange" value="1000" /></div>
    <div class="cell detailsSelection">Runway length: <input type="text" id="runway" value="3000" /></div>
    <div class="cell detailsSelection">Min. Capacity: <input type="text" id="min_capacity" value="0" /></div>
    <div class="cell detailsSelection">Min. Circulation: <input type="text" id="min_circulation" value="500" /></div>
    <div class="cell detailsSelection" style="min-width: 160px; text-align:right">
        <label for="owned_only">Owned Only <input type="checkbox" id="owned_only" /></label>
        <label for="use_flight_total">Flight Fuel Total <input type="checkbox" id="use_flight_total" /></label>
    </div>
`);

	$('[data-sort-property="totalOwned"]').text("Owned");
	$('[data-sort-property="totalOwned"]').attr({ style: "width: 6%;" });

	var newDataFilterElements = ["#fightRange", "#runway", "#min_capacity", "#min_circulation", "#owned_only", "#use_flight_total"];

	for (var el of newDataFilterElements) {
		$(el).change(function () {
			window.updateAirplaneModelTable();
		});
	}

	//* Link Cost Preview

	let _updatePlanLinkInfo = window.updatePlanLinkInfo;
	let _updateTotalValues = window.updateTotalValues;

	let activeLink;
	let idFrom = -1;
	let idTo = -1;
	let airportFrom;
	let airportTo;
	let _modelId = -1;

	let observer = new MutationObserver(function (mutations) {
		updateModelInfo(_modelId);
	});

	observer.observe(document.getElementById("planLinkServiceLevel"), {
		attributes: true,
		attributeFilter: ["value"],
	});

	window.updateTotalValues = function () {
		_updateTotalValues();
		window.updateModelInfo(_modelId);
	};

	window.updatePlanLinkInfo = function (linkInfo) {
		log(linkInfo, true);
		activeLink = linkInfo;

		for (let model of activeLink.modelPlanLinkInfo) {
			for (let airplane of model.airplanes) {
				airplane.airplane.frequency = airplane.frequency;
			}
		}

		if (idFrom != linkInfo.fromAirportId) {
			idFrom = linkInfo.fromAirportId;
			$.ajax({
				url: "airports/" + linkInfo.fromAirportId,
				async: false,
				success: function (result) {
					airportFrom = result;
				},
			});
		}

		if (idTo != linkInfo.toAirportId) {
			idTo = linkInfo.toAirportId;
			$.ajax({
				url: "airports/" + linkInfo.toAirportId,
				async: false,
				success: function (result) {
					airportTo = result;
				},
			});
		}

		_updatePlanLinkInfo(linkInfo);
	};

	let _updateModelInfo = window.updateModelInfo;

	window.updateModelInfo = function (modelId) {
		if (_modelId != modelId) {
			_updateModelInfo(modelId);
		}
		_modelId = modelId;

		let model = loadedModelsById[modelId];
		let linkModel = activeLink.modelPlanLinkInfo.find((plane) => plane.modelId == modelId);
		log({ loadedModelsById, model, linkModel }, true);
		let serviceLevel = parseInt($("#planLinkServiceLevel").val());
		let frequency = 0;

		let plane_category = 0;

		switch (model.airplaneType.toUpperCase()) {
			case "LIGHT":
			case "SMALL":
				plane_category = 1;
				break;
			case "REGIONAL":
				plane_category = 3;
				break;
			case "MEDIUM":
				plane_category = 8;
				break;
			case "LARGE":
				plane_category = 12;
				break;
			case "EXTRA LARGE":
			case "X_LARGE":
				plane_category = 15;
				break;
			case "JUMBO":
				plane_category = 18;
				break;
			case "SUPERSONIC":
				plane_category = 12;
				break;
			default:
				console.error("CPP E1:updateAirplaneModelTable unknown airplane type: " + model.airplaneType);
		}

		let baseSlotFee = 0;

		switch (airportFrom.size) {
			case 1:
			case 2:
				baseSlotFee = 50;
				break;
			case 3:
				baseSlotFee = 80;
				break;
			case 4:
				baseSlotFee = 150;
				break;
			case 5:
				baseSlotFee = 250;
				break;
			case 6:
				baseSlotFee = 350;
				break;
			default:
				baseSlotFee = 500;
				break;
		}

		switch (airportTo.size) {
			case 1:
			case 2:
				baseSlotFee += 50;
				break;
			case 3:
				baseSlotFee += 80;
				break;
			case 4:
				baseSlotFee += 150;
				break;
			case 5:
				baseSlotFee += 250;
				break;
			case 6:
				baseSlotFee += 350;
				break;
			default:
				baseSlotFee += 500;
				break;
		}

		let serviceLevelCost = 1;

		switch (serviceLevel) {
			case 2:
				serviceLevelCost = 4;
				break;
			case 3:
				serviceLevelCost = 8;
				break;
			case 4:
				serviceLevelCost = 13;
				break;
			case 5:
				serviceLevelCost = 20;
				break;
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
		} else if (airportFrom.zone == airportTo.zone) {
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
		if (model.originalPrice) {
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

			let availableFlightMinutes = airplane.availableFlightMinutes - futureFreq * 2 * (linkModel.duration + model.turnaroundTime);

			let utilisation = flightTime / (airplane.maxFlightMinutes - availableFlightMinutes);
			let planeUtilisation = (airplane.maxFlightMinutes - availableFlightMinutes) / airplane.maxFlightMinutes;

			let decayRate = (100 / (model.lifespan * 3)) * (1 + 2 * planeUtilisation);

			depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);

			maintenance += model.capacity * 100 * utilisation;

			frequency += freq;
		}

		if (frequency == 0) {
			let maxFlightMinutes = 4 * 24 * 60;
			frequency = Math.floor(maxFlightMinutes / ((linkModel.duration + model.turnaroundTime) * 2));

			let flightTime = frequency * 2 * (linkModel.duration + model.turnaroundTime);
			let availableFlightMinutes = maxFlightMinutes - flightTime;
			let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
			let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

			let decayRate = (100 / (model.lifespan * 3)) * (1 + 2 * planeUtilisation);
			depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);
			maintenance += model.capacity * 100 * utilisation;
		}

		let fuelCost = frequency;

		if (linkModel.duration <= 90) {
			fuelCost *= model.fuelBurn * linkModel.duration * 5.5 * 0.08;
		} else {
			fuelCost *= model.fuelBurn * (linkModel.duration + 405) * 0.08;
		}

		let crewCost = model.capacity * durationInHour * 12 * frequency;
		let airportFees = (baseSlotFee * plane_category + (Math.min(3, airportTo.size) + Math.min(3, airportFrom.size)) * model.capacity) * frequency;
		let servicesCost = (20 + serviceLevelCost * durationInHour) * model.capacity * 2 * frequency;
		let cost = fuelCost + crewCost + airportFees + depreciationRate + servicesCost + maintenance;

		let staffTotal = Math.floor(basic + staffPerFrequency * frequency + (staffPer1000Pax * model.capacity * frequency) / 1000);

		$("#airplaneModelDetails #FCPF").text("$" + commaSeparateNumber(Math.floor(fuelCost)));
		$("#airplaneModelDetails #CCPF").text("$" + commaSeparateNumber(Math.floor(crewCost)));
		$("#airplaneModelDetails #AFPF").text("$" + commaSeparateNumber(airportFees));
		$("#airplaneModelDetails #depreciation").text("$" + commaSeparateNumber(Math.floor(depreciationRate)));
		$("#airplaneModelDetails #SSPF").text("$" + commaSeparateNumber(Math.floor(servicesCost)));
		$("#airplaneModelDetails #maintenance").text("$" + commaSeparateNumber(Math.floor(maintenance)));
		$("#airplaneModelDetails #cpp").text("$" + commaSeparateNumber(Math.floor(cost / (model.capacity * frequency))) + " * " + model.capacity * frequency);
		$("#airplaneModelDetails #cps").text("$" + commaSeparateNumber(Math.floor(cost / staffTotal)) + " * " + staffTotal);
	};

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

	log("Plane score script loaded");

	function log(toLog, isObject = false) {
		if (debug) {
			const d = new Date();
			let str = "BAC \t" + d.toLocaleTimeString("fr-fr") + "." + String(d.getMilliseconds()).padStart(3, "0") + "\t";

			if (isObject) {
				console.log(str);
				console.dir(toLog);
			} else console.dir(str + toLog);
		}
	}
})();
