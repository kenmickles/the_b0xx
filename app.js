var http = require('http');
var querystring = require("querystring");
var express = require('express');
var app = express.createServer()
var io = require('socket.io').listen(app);

app.configure(function(){
  // app.set('views', __dirname + '/views');
  // app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  // app.use(express.static(__dirname + '/public'));
});

app.listen(8080);

// routing
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

app.post('/incoming', function (req, res) {
  var from = req.body.From;  
  var query = req.body.Body;
  
  console.log('From: ' + from + ', Query: ' + query);
  
  var options = {
      host: 'gdata.youtube.com',
      port: 80,
      path: '/feeds/api/videos?q=' + querystring.stringify({q: query, alt: 'json'}),
      method: 'GET'
  };
  
  var request = http.request(options, function(response){
    response.setEncoding("utf8");

    var body = [];

    response.on("data", function (chunk) {
        body.push(chunk);
    });

    response.on("end", function () {
      var data = JSON.parse(body.join(""));
      
      // success!
      if ( typeof(data.feed.entry[0]) != 'undefined' ) {
        var video_id = data.feed.entry[0].id.$t.replace('http://gdata.youtube.com/feeds/api/videos/', '');
        var title =  data.feed.entry[0].title.$t;
                
        // queue video
        io.sockets.emit('play', video_id);
        
        // success message
        var message = title + " was queued in position #5";
        
        console.log('Found #' + video_id + ': ' + title);
      }
      // failure :(
      else {
        var message = "Sorry, but I couldn't find your video :(";
      }

      // output twilio response
      var twiml = '<?xml version="1.0" encoding="UTF-8" ?>\n<Response>\n<Sms>' + message + '</Sms>\n</Response>';
      res.send(twiml, {'Content-Type':'text/xml'}, 200);
    });
  });

  request.end();
});

io.sockets.on('connection', function (socket) {
	// when the user disconnects.. perform this
	socket.on('disconnect', function(){
    //
	});
});