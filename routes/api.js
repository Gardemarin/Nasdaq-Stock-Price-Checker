/*
*
*
*       Complete the API routing below
*       Not the Best code, but works better, than original ! ;)
*
*/

'use strict';

var expect       = require('chai').expect;
var googleStocks = require('google-stocks');
var _            = require('lodash');
var STOCK_NAME   = process.env.NODE_ENV;
var MongoClient  = require('mongodb').MongoClient, 
    assert       = require('assert');

const CONNECTION_STRING = process.env.DB;

module.exports = function (app) {

  app.route('/api/stock-prices')
  .get(function (req, res){
    var ip = req.clientIp;
    let reqData = req.query;
    if (typeof(reqData.stock) === 'object')
      reqData.stock.map((item, i) => {
        reqData.stock[i] = item.toUpperCase();
      });
    else reqData.stock = reqData.stock.toUpperCase();
    
    var rez = [];
    var rezultatas = { stockData: [] };

    googleStocks([reqData.stock])
    .then(data => {
      
      data.map(stock => {
        reqData.stock = _.without(reqData.stock, stock.t);
        rez.push({ stock: stock.t, price: stock.l });
      });

      if (reqData.stock.length === 0){
            MongoClient.connect(CONNECTION_STRING, function(err, db) {
              assert.equal(null, err);
              console.log("Connected correctly to server");
              
              // Create a collection
              var collection = db.collection(STOCK_NAME);
              collection.createIndex({stock: 1}, { unique: true });     
              
              rez.map(item => {
                checkStock(collection, item, function(err, info){
                  // console.log('return CheckStock:', err, info, item.stock);
                });  
                
                updateStock(collection, item, function(err, info){
                  // console.log('return UpdateStock:', err, info, item.stock);
                }); 
                
                if (reqData.like){
                  addUserIpTo(collection, item.stock, ip, function(err, info) {
                    // console.log("return UpdateIP:", err, info, item.stock);
                  });
                }  
              });
              rez.map(item => {
                
                if (rez.length === 1){
                  getOneStock(collection, item, function(err, info){
                    rezultatas.stockData = info;
                    res.json(rezultatas);
                  });
                }
                else {
                  getBothStocks(collection, rez, item, function(err, info){
                    rezultatas.stockData.push(info);
                    if (rezultatas.stockData.length === 2)
                      res.json(rezultatas);
                  });
                }
              });
          });
      } else {
        res.send(`Error: [ Stock ${reqData.stock} doesn't exist ]`);
      }
    })
    .catch(error => {
      res.send(`Error: [ Stocks ${reqData.stock} doesn't exist ]`);
    });
  });
};


function checkStock(stockTable, data, callBack){
  stockTable.findAndModify(
    { $and: [ {stock: { $exists: true}}, {stock: { $eq: data.stock } } ] }, [],
    { $set: { price: data.price }, $setOnInsert: { stock: data.stock, ip_list: [] } },
    { upsert: true },
    (err, info) => {
       return callBack(err, info);
    }
  );    
}

function updateStock(stockTable, data, callBack){
  stockTable.findAndModify(
    { $and: [{stock: { $eq: data.stock}}, { price: { $ne: data.price} } ] }, [],
    { $set: { price: data.price }},
    (err, info) => {
      return callBack(err, info);
    }
  ); 
}

function addUserIpTo(stockTable, stock, ip, callBack){
  stockTable.findAndModify(
    { stock: { $eq: stock}, ip_list:  { $not: { $in: [ip] } } }, 
    [], 
    { $push: { ip_list: ip }}, {  new: true },
    (err, rez) => { 
      return callBack(err, rez);
    }
  );
}

function getOneStock(stockTable, item, callBack){
  stockTable.aggregate(
    [{ $match: { stock: item.stock } },
     { $project : { 
        _id: 0, stock: 1, price: 1, 'likes': { $size: "$ip_list"}
      }
     }
    ],	  
    function(err, results) {
        assert.equal(err, null);
        callBack(err, results[0]);
      }
  )
}

function getBothStocks(stockTable, stocks, item, callBack){
      stockTable.aggregate([
      { $match:  { stock: { $in: [ stocks[0].stock, stocks[1].stock ] }}},
      { '$unwind': { path:'$ip_list', preserveNullAndEmptyArrays: true}},
      { '$project': { 
          stock: 1,  
          'rel_likes': { 
            $sum : {
              $cond: [ {"$ne": [ stocks[0].stock, stocks[1].stock]},{
                  $cond: [
                    { "$eq": [ "$stock", item.stock] },
                      { $cond: [ { "$eq": [ { $ifNull: [ '$ip_list', undefined]}, undefined] }, 0, 1 ]}, 
                      { $cond: [ { "$eq": [ { $ifNull: [ '$ip_list', undefined]}, undefined] }, 0, -1 ]},
                  ]
                }, 0
              ]
            } 
          } 
        } 
      },
      { $group: {
        _id: null,  rel_likes: { $sum: '$rel_likes' }
      }}, 
      { '$project': {
        _id: 0,  stock: { $literal: item.stock }, price: { $literal: item.price }, rel_likes:1
        }
      }
    ],	  
    function(err, results) {
      assert.equal(err, null);
      callBack(err, results[0]);
    }
  )
  
}