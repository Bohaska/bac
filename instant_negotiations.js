// ==UserScript==
// @name         Instant negotiations
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Route negotiations load immediately
// @author       bohaska (Fly or die)
// @match        https://*.airline-club.com/
// @match        https://*.myfly.club/*
// @icon         https://www.google.com/s2/favicons?domain=airline-club.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    window.negotiationAnimation = function(savedLink, callback, callbackParam) {
        var negotiationResult = savedLink.negotiationResult
        $('#negotiationAnimation .negotiationIcons').empty()
        //plotNegotiationGauge($('#negotiationAnimation .negotiationBar'), negotiationResult.passingScore)
        animateProgressBar($('#negotiationAnimation .negotiationBar'), 0, 0)
        $('#negotiationAnimation .negotiationDescriptions').text('')
        $('#negotiationAnimation .negotiationBonus').text('')
        $('#negotiationAnimation .negotiationResult').hide()

        var animation = savedLink.airportAnimation
        if (animation.label) {
            $('#negotiationAnimation .animationLabel').text(animation.label)
        } else {
            $('#negotiationAnimation .animationLabel').empty()
        }

        var animationUrl = animation.url
        if (localStorage.getItem("autoplay") === 'true') {
            animationUrl += "?autoplay=1"
        }
        $('#negotiationAnimation .clip').attr('src', animationUrl)


        var gaugeValue = 0

        var index = 0
        $('#negotiationAnimation .successRate').text(Math.floor(negotiationResult.odds * 100))

        $(negotiationResult.sessions).each( function(index, value) {
            $('#negotiationAnimation .negotiationIcons').append("<img src='assets/images/icons/balloon-ellipsis.png' style='padding : 5px;'>")
        });
        var animationInterval = setInterval(function() {
            var value = $(negotiationResult.sessions)[index ++]
            var icon
            var description
            if (value > 14) {
                icon = "smiley-kiss.png"
                description = "Awesome +" + Math.round(value)
            } else if (value > 11) {
                icon = "smiley-lol.png"
                description = "Great +" + Math.round(value)
            } else if (value > 8) {
                icon = "smiley.png"
                description = "Good +" + Math.round(value)
            } else if (value > 5) {
                icon = "smiley-neutral.png"
                description = "Soso +" + Math.round(value)
            } else if (value > 0) {
                icon = "smiley-sad.png"
                description = "Bad +" + Math.round(value)
            } else {
                icon = "smiley-cry.png"
                description = "Terrible " + Math.round(value)
            }
            $('#negotiationAnimation .negotiationIcons img:nth-child(' + index + ')').attr("src", "assets/images/icons/" + icon)
            $('#negotiationAnimation .negotiationDescriptions').text(description)


            //$('#linkConfirmationModal .negotiationIcons').append("<img src='assets/images/icons/" + icon + "'>")
            gaugeValue += value
            var percentage = gaugeValue / negotiationResult.passingScore * 100

            var callback
            if (index == negotiationResult.sessions.length) {
                callback = function() {
                    var result
                    if (negotiationResult.isGreatSuccess) {
                        result = "Great Success"
                    } else if (negotiationResult.isSuccessful) {
                        result = "Success"
                    } else {
                        result = "Failure"
                    }
                    if (savedLink.negotiationBonus) {
                        $('#negotiationAnimation .negotiationBonus').text(savedLink.negotiationBonus.description)
                    } else if (savedLink.nextNegotiationDiscount) {
                        $('#negotiationAnimation .negotiationBonus').text(savedLink.nextNegotiationDiscount)
                    }

                    $('#negotiationAnimation .negotiationResult .result').text(result)
                    $('#negotiationAnimation .negotiationResult').show()

                    if (negotiationResult.isGreatSuccess) {
                        $('#negotiationAnimation').addClass('transparentBackground')
                        startFirework(20000, savedLink.negotiationBonus.intensity)
                    } else if (negotiationResult.isSuccessful) {
                        showConfetti($("#negotiationAnimation"))
                    }
                };
            }
            animateProgressBar($('#negotiationAnimation .negotiationBar'), percentage, 1, callback)

            if (index == negotiationResult.sessions.length) {
                clearInterval(animationInterval);
            }
        }, 1)


        if (callback) {
            $('#negotiationAnimation .close, #negotiationAnimation .result').on("click.custom", function() {
                if (negotiationResult.isGreatSuccess) {
                    $('#negotiationAnimation').removeClass('transparentBackground')
                    stopFirework()
                } else if (negotiationResult.isSuccessful) {
                    removeConfetti($("#negotiationAnimation"))
                }
                callback(callbackParam)
            })
        } else {
            $('#negotiationAnimation .close, #negotiationAnimation .result').off("click.custom")
        }

        $('#negotiationAnimation .close, #negotiationAnimation .result').on("click.reset", function() {
            // sets the source to nothing, stopping the video
            $('#negotiationAnimation .clip').attr('src','');
        })

        $('#negotiationAnimation').show()
    }
})();
