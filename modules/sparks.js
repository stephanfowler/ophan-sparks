"use strict";

var defaults = {              // Examples:
        graphs:      'total', // 'other:d61d00,google:89A54E,guardian:4572A7',
        markers:     '',      // 'markers=1388680400:ff9900,1388681200:ff0000'
        width:       50,
        height:      20,
        hotLevel:    50,
        hotPeriod:   5,
        alpha:       0.7,
        smoothing:   5,
        showStats:   0,       // 1, to enable
        showHours:   0        // 1, to enable
    },

    Canvas = require('canvas'),
    _ = require('lodash');

function resample(arr, newLen) {
    var arrLen = arr.length,
        span;
       
    if (arrLen <= newLen) { return arr; }
   
    span = arrLen / (newLen || 1);

    return _.map(_.range(0, arrLen - 1, span), function(left){
        var right = left + span,
            lf = Math.floor(left),
            lc = Math.ceil(left),
            rf = Math.floor(right),
            rc = Math.min(Math.ceil(right), arrLen - 1);

        return (
            _.reduce(_.range(lc, rf), function(sum, i) { return sum + arr[i]; }, 0) +
            arr[lf] * (lc - left) +
            arr[rc] * (right - rf)
        ) / (span || 1);
    });
}

function average(arr) {
    var len = arr.length;

    if (!len) { return 0; }
    if (len === 1) { return arr[0]; }
    return _.reduce(arr, function(acc, x) { return acc + x; }) / len;
}

function smooth(arr, r) {
    if (r < 2) { return arr; }
    return _.map(arr, function(x, i, arr) {
        return average(arr.slice(i, i+r));
    });
}

function numWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function containsStr(a, b) {
    return a.toLowerCase().indexOf(b.toLowerCase()) > -1;
}

function hexToRgba(hex, alpha) {
    hex = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, function(m, r, g, b) { return r + r + g + g + b + b; });
    hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return 'rgba(' + (hex ? parseInt(hex[1], 16) + ',' + parseInt(hex[2], 16) + ',' + parseInt(hex[3], 16) : '0,0,0') +  ',' + alpha + ')';
}

function collateOphanData(data, opts) {
    var graphs = _.map(opts.graphs.split(','), function(graph) {
            var p = graph.split(':');
            return { name: p[0], color: (p[1] || '666666') };
        });

    if(graphs.length && data.seriesData && data.seriesData.length && data.seriesData[0].data && data.seriesData[0].data.length) {
        var graphTotal = _.find(graphs, function(g){ return containsStr('total', g.name); }),
            graphOther = _.find(graphs, function(g){ return containsStr('other', g.name); });
        
        _.each(data.seriesData, function(s){
            var graphThis = _.find(graphs, function(g){ return containsStr(s.name, g.name); }) || graphOther;

            _.each(_.filter([graphThis, graphTotal], function(g) { return g; }), function(graph) {
                if (graph.data) {
                    _.each(s.data, function(d, i) {
                        graph.data[i] = (graph.data[i] || 0) + d;
                    });
                } else {
                    graph.data = s.data;
                }
            });
        });

        graphs = _.filter(graphs, function(graph) { return graph.data; });

        if (!graphs.length) { return; }

        graphs = _.map(graphs, function(graph){
            var hotness = average(_.last(graph.data, opts.hotPeriod));
            graph.hotness = hotness < opts.hotLevel ? hotness < opts.hotLevel/2 ? 1 : 2 : 3;
            graph.data = smooth(resample(graph.data, opts.width), opts.smoothing);
            return graph;
        });

        return {
            seriesData: graphs,
            totalHits: data.totalHits,
            points: graphs[0].data.length,
            startSec: data.startDate/1000,
            endSec: data.endDate/1000
        };
    }
}

function draw(data, opts) {
    if (!data) { return; }

    var w = opts.width,
        h = opts.height,
        p = data.points,
        graphHeight = h - (opts.showStats ? 11 : 2),
        // point-width is 10% of width for a single-point graph, progressing down to 1px as the point number grows.
        xStep = p < w ? 0.9 + 0.1 * w /(p || 1) : 1,
        yStep = graphHeight/(opts.hotLevel || 1),
        yCompress = Math.min(opts.hotLevel/(_.max(_.map(data.seriesData, function(graph) { return _.max(graph.data); })) || 1), 1),
        elapsedSec = data.endSec - data.startSec,
        canvas = new Canvas(w, h),
        ctx = canvas.getContext('2d'),
        drawMark = function (markSec, hexColor, withFlag) {
            var x;

            if (!markSec || markSec < data.startSec) { return; }
            
            x = Math.floor(w + ((Math.min(markSec, data.endSec) - data.startSec)/(elapsedSec || 1) - 1)*p*xStep);
            
            ctx.beginPath();
            ctx.lineTo(x, 2);
            ctx.lineTo(x, graphHeight + 2);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#' + (hexColor || '999999');
            ctx.stroke();

            if (withFlag) {
                ctx.fillStyle = '#' + (hexColor || '999999');
                ctx.fillRect(x - 2, 0, 2, 2);
            }
        };

    if (opts.showStats) {
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#999999';
        ctx.fillText(numWithCommas(data.totalHits), w - 1, h - 1);
    }

    ctx.translate(-0.5, -0.5); // reduce antialiasing

    if (opts.showHours) {
        _.each(_.range(data.endSec, data.startSec, -3600), function(hour) {
            drawMark(hour, 'f0f0f0');
        });
    }

    if (opts.markers) {
        _.each(opts.markers.split(','), function(m) {
            m = m.split(':');
            drawMark(_.parseInt(m[0]), m[1], true);
        });
    }

    _.each(data.seriesData, function(s) {
        if (average(s.data) < 1) { return; }
        ctx.beginPath();
        _.each(s.data, function(y, x){
            if (!x && p === w) { return; }
            ctx.lineTo(w + (x - p + 1)*xStep - 1, graphHeight - yStep*yCompress*y + 2); // + 2 so thick lines don't get cropped at top
        });
        ctx.lineWidth = s.hotness;
        ctx.strokeStyle = hexToRgba(s.color, opts.alpha);
        ctx.stroke();
    });

    return canvas;
}

module.exports = function (params) {
    var opts = _.assign(params, defaults, function(a, b) { return !_.isUndefined(a) ? _.isNumber(b) ? +a || 0 : a : b; });

    this.draw = function(ophanData) {
        return draw(collateOphanData(ophanData, opts), opts);
    };
};

