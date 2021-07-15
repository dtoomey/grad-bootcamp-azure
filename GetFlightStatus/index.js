var flightAwareBasePath = "https://flightxml.flightaware.com/json/FlightXML2/";
var flightAwareUsername = process.env["flightAwareUsername"]
var flightAwarePassword = process.env["flightAwarePassword"]
var buffer = Buffer.from(flightAwareUsername + ":" + flightAwarePassword);
var flightAwareAuthHeader = "Basic " + buffer.toString('base64');

module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');

    if (req.query.flightNumber && req.query.flightNumber != ''
        && req.query.departureTime && req.query.departureTime != '' ) {

        let flightNumber = req.query.flightNumber;
        let departureTime = req.query.departureTime;
        let flightId = getFlightId(context, flightNumber, departureTime);        
        context.log('flightId: ' + flightId);

        let flightInfoResponseBody = await getFlightInfo(context, flightId);
        if (flightInfoResponseBody == null) {
            context.log.error('Empty response returned from the downstream service.')
        }
        
        if (flightInfoResponseBody.length < 40 && flightInfoResponseBody.indexOf("NO_DATA flight not found") > -1){
            context.res = {
                status: 404,
                body: "Flight '" + flightId + "' Not Found"
            };            
        }
        else {
            try {
                let flights = JSON.parse(flightInfoResponseBody).FlightInfoExResult.flights;
                if (flights.length != 1) {
                    context.res = {
                        status: 400,
                        body: "Bad Request. Flight Id '" + flightId + "' did not return 1 flight."
                    };            
                }
                else {
                    let flightInfo = JSON.parse(flightInfoResponseBody).FlightInfoExResult.flights[0];
                    let claimRefundRules = getClaimRefundRules(flightInfo);
                    context.res = {
                        status: 200, 
                        body: claimRefundRules
                    };
                }                    
            } catch (error) {
                context.log.error("Error parsing response: " + flightInfoResponseBody);
            }           
        }
    }
    else {
        context.res = {
            status: 400,
            body: "Please pass flightNumber and date values in the query string"
        };
    }
};

async function getFlightInfo(context, flightId) {
    let request = require('request');
    let url = flightAwareBasePath + "FlightInfoEx";
    let queryParams = { 'ident': flightId };
    let headers = { 'Authorization': flightAwareAuthHeader}
    context.log(url + '?' + queryParams);

    return new Promise((resolve, reject) => {
        request({
            url:url, 
            qs:queryParams, 
            headers:headers, 
            method: 'GET'
            }, 
            function(err, response, body) {
                if (!err && response.statusCode == 200) {
                    resolve(body);
                }
                else {
                    reject(err);
                }
            }
        );
    });
}

function getFlightId(context, flightNumber, departureTime) {
    context.log('getFlightId Parms: flightNumber = ' + flightNumber + ', departureTime = ' + departureTime);
    // Converts to epoch time
    let departureTimeEpoch = new Date(departureTime);
    departureTimeEpoch = departureTimeEpoch / 1000;  //convert milliseconds to seconds 
    return flightNumber + '@' + (departureTimeEpoch);
}

function getClaimRefundRules(flightInfo) {
    let refund = 0;
    let delayInMinutes = null;
    let flightStatus = "";
    let offset = (new Date().getTimezoneOffset() / 60) * -1;
    let scheduleDepatureTime = new Date((flightInfo.filed_departuretime + offset * 60 * 60) * 1000).toISOString().slice(0, -1);
    let actualDepartureTime = (flightInfo.actualdeparturetime > 0) ? new Date((flightInfo.actualdeparturetime + offset * 60 * 60) * 1000).toISOString().slice(0, -1) : null;    
    let actualArrivalTime = (flightInfo.actualarrivaltime > 0) ? new Date((flightInfo.actualarrivaltime + offset * 60 * 60) * 1000).toISOString().slice(0, -1) : null;
    if (flightInfo.actualdeparturetime > 0 && flightInfo.filed_departuretime > 0 && flightInfo.actualdeparturetime > flightInfo.filed_departuretime){
        delayInMinutes = Math.floor((flightInfo.actualdeparturetime - flightInfo.filed_departuretime) / 60);
    }
        
    if (flightInfo.actualdeparturetime == 0) {
        flightStatus = "scheduled";
    } 
    else if (flightInfo.actualdeparturetime == -1){
        flightStatus = "cancelled";       
        refund = 300
    } 
    else if (delayInMinutes > 60){
        flightStatus = "delayed";       
        refund = 200
    } 
    else if (delayInMinutes > 30){
        flightStatus = "delayed";       
        refund = 100
    }
    else if (delayInMinutes <= 30){
        flightStatus = "on time"; 
    }

    let claimRefundRules = {
        id: flightInfo.ident + '@' + flightInfo.filed_departuretime,
        flightStatus: flightStatus,
        scheduleDepatureTime: scheduleDepatureTime,
        actualDepartureTime: actualDepartureTime,
        actualArrivalTime: actualArrivalTime,
        delayInMinutes: delayInMinutes,
        refund: refund
    }
    return claimRefundRules;
}
