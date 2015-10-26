#!/usr/bin/env node

//依赖模块
var fs = require('fs'),
    request = require("request"),
    mkdirp = require('mkdirp'),
    async = require('async'),
    xml2js = require('xml2js'),
    colors = require('colors'),
    appInfo = require('./package.json');

var Downloader = {
    /** 
	* Config options 
	*/
    options: {
        site: process.argv[2],
        num: 50,
        start: 0,
        concurrency: 8,
        retry_time: 2,
        retried_time: 0,
        total_page: 0,
        dir: process.argv[3] ? process.argv[3] + '/' + process.argv[2] : './tumblr/' + process.argv[2]
    },
    wrapTask: function (task, context, exArgs) {
		var self = this;
		return function () {
			var args = [].slice.call(arguments);
			args = exArgs ? exArgs.concat(args) : args;
			task.apply(context || self, args);
		};
	},
    start: function (retry) {
        var self = this;

        self.mkdirp();

        console.log(colors.green('Downloading photos from ' + self.options.site + ', concurrency=' + self.options.concurrency + ' ...'));

        self.run(retry);
    },
    run: function(retry){
        var self = this;
        async.waterfall([
            function(callback){
                var url = 'http://' + self.options.site + '/api/read?type=photo&num=' + self.options.num + '&start=' + self.options.start;
                callback(null, retry, url)
            },
            self.wrapTask(self.crawlPosts),
            self.wrapTask(self.getPosts),
            self.wrapTask(self.parsePosts),
            self.wrapTask(self.downImages)
        ], function (err, result) {
            if (err){
                console.log('Code: \'%s\', Message: \'%s\''.red, err.code, err.message);
                self.options.retried_time += 1;
            } 
            if (err && self.options.retried_time <= self.options.retry_time) {
                if (self.options.retry_time - self.options.retried_time + 1) {
                    console.log(colors.bgWhite.black('Retry in 3s...(will retry ' + (self.options.retry_time - self.options.retried_time + 1) + ' times)'));
                } else {
                    console.log('Retry in 3s...'.bgWhite.black);
                }
                setTimeout(function () {
                    self.run(true);
                }, 3000);
            } else {
                console.log('Starting grab new page posts...'.bgGreen.black);
                self.options.retried_time = 0;
                self.options.total_page += 1;
                self.options.start += self.options.num;
                self.run();
            }
        });  
    },
    crawlPosts: function(retry,url,callback){
        var self = this;
        if(retry && self.options.retried_time && self.options.retried_time <= self.options.retry_time){
            console.log(self.options.retried_time + ' time: retrying crawl posts from ' + self.options.start + ' to ' + (self.options.start + self.options.num) + '...');
        }else{
            console.log('Crawling posts from ' + self.options.start + ' to ' + (self.options.start + self.options.num) + '...');
        }
        request(url, function (err, response, body) {
            if(!err && response.statusCode == 200) {
                console.log('✔'.green + ' Crawled posts from ' + self.options.start + ' to ' + (self.options.start + self.options.num));
            }
            callback(err, body);
        });
    },
    getPosts: function(body, callback){
        var self = this;
        xml2js.parseString(body, { explicitArray: false }, function(err, data){
            if(!data){
                console.log('Unknown error, please try it again later.'.red);
                return false;
            }
            console.log('Total Posts: ' + data.tumblr.posts.$.total);
            var posts = data.tumblr.posts.post;
            if(posts && posts instanceof Array == false) posts = [posts];
            callback(err, posts);
        });
    },
    parsePosts: function(posts, callback){
        var self = this;
        if(posts){
            var images = [];
            posts.forEach(function (element) {
                if (element['photoset']) {
                    var photoset = element['photoset']['photo'];
                    photoset.forEach(function (photo) {
                        images.push(photo['photo-url'][0]._);
                    });
                } else {
                    images.push(element['photo-url'][0]._);
                }
            }, this);
            console.log(images.length + ' images found (' + self.options.start + ' to ' + (self.options.start + self.options.num) + ')');
            callback(null, images);
        }else{
            console.log("Our work here is done!".rainbow);
            console.log('Total pages: ' + self.options.total_page);
            self.exit();
        }
    },
    downImages: function(images, callback){
        var self = this;
        async.eachLimit(
            images, 
            self.options.concurrency, 
            self.wrapTask(self.downImage), 
            function (err) {
                callback(err);
            });
    },
    downImage: function(item, callback){
        var self = this;
        var filename = item.match(/[^/\\\\]+$/ig)[0];
        request.head(item, function (err, res, body) {
            if (!err) {
                if (self.isExist(filename, res)) {
                    console.log('Already have %s'.gray, item);
                    callback();
                } else {
                    self.download(item, self.options.dir, filename, function (err) {
                        callback(err);
                    });
                }
            } else {
                console.log('Requesting header info: %s'.yellow, item);
                callback(err);
            }
        });
    },
    isExist: function(filename, res){
        var self = this;
        return fs.existsSync(self.options.dir + "/" + filename) && 
               res.headers['content-length'] == fs.statSync(self.options.dir + "/" + filename).size;
    },
    download: function (url, dir, filename, callback) {
        var toPath = dir + "/" + filename;
        request(url)
            .pipe(fs.createWriteStream(toPath))
            .on('close', function () {
                console.log('✔'.green + ' %s', url);
                callback();
            })
            .on('error', function(err) {
                callback(err);
            });
    },
    mkdirp: function(){
        var self = this;
        mkdirp(self.options.dir, function (err) {
            if (err) {
                console.log(err.red);
            }
        })
    },
    exit: function(){
        process.exit();
    }
};

switch(process.argv[2]){
    case '-v':
    case '--version':
        console.log('version is ' + appInfo.version);
        break;
    case '-h':
    case '--help':
        console.log('Useage: tumblr-dl <url> [<directory>]');
        console.log('Options:');
        console.log('  -v --version output the version number');
        console.log('  -h --help    output usage information');
        break;
    default:
        if(!process.argv[2]){
            console.log('Usage: tumblr-dl <url> [<directory>]');
            console.log('eg. tumblr-dl xxx.tumblr.com');
            console.log('eg. tumblr-dl xxx.tumblr.com ~/pictures/xxx.tumblr/');
            process.exit();
        }else{
            Downloader.start();
        }
}