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
  
  // skip this video
  if ( query.match(/^(Skip|Next)$/i) ) {
    play_next();
    
    // output twilio response
    var twiml = '<?xml version="1.0" encoding="UTF-8" ?>\n<Response>\n<Sms>Yes, sir!</Sms>\n</Response>';
    res.send(twiml, {'Content-Type':'text/xml'}, 200);

    return;
  }
  // set volume
  else if ( query.match(/^Volume\s(\d*)/i) ) {
    var volume = query.replace(/^Volume\s/i, '');
    io.sockets.emit('volume', volume);
    
    // output twilio response
    var twiml = '<?xml version="1.0" encoding="UTF-8" ?>\n<Response>\n<Sms>Volume set to ' + volume + ', sir :)</Sms>\n</Response>';
    res.send(twiml, {'Content-Type':'text/xml'}, 200);    
    
    return;
  }
  
  var options = {
      host: 'gdata.youtube.com',
      port: 80,
      path: '/feeds/api/videos?' + querystring.stringify({q: query, alt: 'json'}),
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
      
      // fail! return error message and exit
      if ( typeof(data.feed.entry) == 'undefined' ) {
        var twiml = '<?xml version="1.0" encoding="UTF-8" ?>\n<Response>\n<Sms>Sorry, but I couldn\'t find your video :(</Sms>\n</Response>';
        res.send(twiml, {'Content-Type':'text/xml'}, 200);
        return;
      }
      
      var video_id = data.feed.entry[0].id.$t.replace('http://gdata.youtube.com/feeds/api/videos/', '');
      var title =  data.feed.entry[0].title.$t;
            
      console.log('Found #' + video_id + ': ' + title);
              
      // queue video
      var db = fetch_db();      
      db.query('INSERT IGNORE INTO queue (video_id) VALUES (?)', [video_id], function(err){
        // fetch queue position
        db.query('SELECT COUNT(*) AS position FROM queue', function(err, results){
          var message = title + ' was queued in position #' + results[0].position;
          
          // output twilio response
          var twiml = '<?xml version="1.0" encoding="UTF-8" ?>\n<Response>\n<Sms>' + message + '</Sms>\n</Response>';
          res.send(twiml, {'Content-Type':'text/xml'}, 200);
          
          // update client status
          io.sockets.emit('status', message);
          
          // clean up
          db.end();          
        });
      });
    });
  });
  
  request.end();
});

app.post('/photo', function (req, res){
  var photo = req.body.photo;
  console.log('Received photo: ' + photo);
  io.sockets.emit('photo', photo);
  
  res.send("Received photo :)", {'Content-Type':'text/plain'}, 200);
});

io.sockets.on('connection', function (socket) {
  socket.on('next', function(){
    play_next();
  });
  
	// when the user disconnects.. perform this
	socket.on('disconnect', function(){
    //
	});
});

function play_next() {
  var db = fetch_db();
  
  // find next video in queue
  db.query('SELECT * FROM queue ORDER BY created_at LIMIT 1', function(err, results, fields){
    if (err) throw err;
    
    if ( results.length > 0 ) {
      var video_id = results[0].video_id;
      
      // remove from queue
      db.query('DELETE FROM queue WHERE video_id = ?', [video_id]);
    
      // add to library
      db.query('REPLACE INTO library (video_id, played_at) VALUES (?, NOW())', [video_id]);
      
      // start playing video
      io.sockets.emit('play', video_id);
      
      // clean up
      db.end();      
    }
    // nothing in queue. find next video in library      
    else {
      db.query('SELECT * FROM library ORDER BY played_at LIMIT 1', function(err, results, fields){
        if (err) throw err;
        
        if ( results.length > 0 ) {
          var video_id = results[0].video_id;
          
          // update play time for this video
          db.query('UPDATE library SET played_at = NOW() WHERE video_id = ?', [video_id]);
        }
        // if all else fails, just play Danzig again
        else {
          var video_id = 'vgSn0SbQJQI';
        }
                
        // play video
        io.sockets.emit('play', video_id);
        
        // clean up
        db.end();
      });
    }
  });
}

function fetch_db() {
  var db = require('mysql').createClient({
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
  });
  db.useDatabase(process.env.MYSQL_DB);
  return db;
}